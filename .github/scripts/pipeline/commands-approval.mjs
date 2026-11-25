// commands-approval: split from pipeline-pre.mjs (pure move).
import {
  api,
  labelsOf,
  list,
  reviewThreads,
  editLabels,
  graphql,
  OWNER,
  NAME,
} from '../github.mjs';
import {
  COPILOT_LOGINS,
  PROTECTED_CONTEXT,
  parseDispositionNotes,
  dispositionKinds,
  evaluateApproval,
  classifyThreads,
  renderGatesComment,
  MARKERS,
  COPILOT_REVIEWER,
  stageTransition,
  shouldMarkReady,
  previewUrl,
  GATES_CONTEXT,
} from '../pipeline-lib.mjs';
import {
  botLogin,
  findBotComment,
  num,
  ownerLogin,
  protectedEvaluation,
  readState,
  requireCopilot,
  reviewStateOf,
  setGatesStatus,
  setStatus,
  upsertBotComment,
  writeOutcome,
  writeState,
} from './helpers.mjs';

export const approvalCommands = {
  approval([pr]) {
    const n = num(pr);
    const bot = botLogin();
    const p = api(`pulls/${n}`);
    const head = p.head.sha;
    const labels = labelsOf(n);
    // Latest conclusion of a check run: undefined when there is none, null
    // while it runs.
    const conclusionOf = (name) => {
      const runs = api(
        `commits/${head}/check-runs?check_name=${name}&per_page=100`,
      ).check_runs.sort((a, b) => b.id - a.id);
      return runs.length ? runs[0].conclusion : undefined;
    };
    const statuses = api(`commits/${head}/statuses?per_page=100`);
    const comments = list(`issues/${n}/comments`);
    const threads = reviewThreads(n);
    const copilotReviewedHead = list(`pulls/${n}/reviews`).some(
      (r) => COPILOT_LOGINS.includes(r.user?.login) && r.commit_id === head,
    );
    const state = readState(n);
    // Recomputed from the changed files and the approval records, so a push
    // after the approval is pending again whatever the status says.
    const protectedEval = protectedEvaluation(p, comments);
    setStatus(PROTECTED_CONTEXT, head, protectedEval, statuses);
    const records = parseDispositionNotes(comments, bot);
    const kinds = dispositionKinds({ records, ownerLogin: ownerLogin() });
    // review.yml's `pipeline/review` on this head; only pipeline PRs need it.
    const reviewState = reviewStateOf(statuses);
    const decision = evaluateApproval({
      prState: p.state,
      labels,
      headSha: head,
      ciConclusion: conclusionOf('ci') ?? null,
      securityJobConclusion: conclusionOf('security'),
      reviewRequired: protectedEval.pipelinePr,
      reviewState,
      unresolvedThreads: threads.filter((t) => !t.isResolved).length,
      copilotReviewedHead,
      requireCopilot: requireCopilot(),
      protectedRequired: protectedEval.required,
      protectedApprovalState: protectedEval.state,
      state,
    });
    console.log(
      `approval: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );

    if (decision.gates) {
      console.log(
        `gates: ${decision.gates.state} (${decision.gates.description})`,
      );
      setGatesStatus(head, decision.gates, statuses);
      const open = classifyThreads(threads, { botLogin: bot })
        .filter((t) => t.id && !t.thread.isResolved)
        .map((t) => ({
          id: t.id,
          source: t.source === 'review' ? 'Claude review' : 'Copilot',
          text: `${t.thread.path ?? ''}${t.thread.line ? `:${t.thread.line}` : ''} ${t.thread.first?.body ?? ''}`,
        }));
      const body = renderGatesComment({
        head,
        gates: decision.gates,
        open,
        dispositions: [...kinds].map(([id, kind]) => ({
          id,
          kind,
          ...records.findLast((r) => r.id === id),
        })),
      });
      // Editing a comment triggers nothing; skip the write when unchanged.
      if (findBotComment(n, MARKERS.gates)?.body !== body)
        upsertBotComment(n, MARKERS.gates, body);
    }

    if (decision.action === 'request-copilot') {
      const saved = process.env.GH_TOKEN;
      if (process.env.COPILOT_GH_TOKEN)
        process.env.GH_TOKEN = process.env.COPILOT_GH_TOKEN;
      try {
        api(`pulls/${n}/requested_reviewers`, {
          method: 'POST',
          body: { reviewers: [COPILOT_REVIEWER] },
        });
      } catch (e) {
        process.env.GH_TOKEN = saved;
        writeOutcome(n, {
          stage: 'approval',
          result: 'problem',
          problem: 'copilot_request_failed',
          summary: 'Approval stopped: could not request a Copilot review.',
          details: [
            'Check that Copilot code review is enabled for this repo and that `COPILOT_REVIEW_TOKEN` belongs to a user with Copilot access.',
          ],
        });
        throw e;
      } finally {
        process.env.GH_TOKEN = saved;
      }
      writeState(n, { ...state, copilotRequestedFor: head });
    }

    if (decision.action === 'human-approval') {
      writeOutcome(n, {
        stage: 'approval',
        result: 'success',
        summary: `Handed to human approval at ${head.slice(0, 7)}.`,
      });
      editLabels(n, stageTransition(labels, 'stage:human-approval'));
      // Only for the PRs the pipeline opened as drafts. A failure here must
      // not end the hand-off: the outcome and label are written already, and
      // the comment and state below are what keep it from repeating.
      let stillDraft = false;
      if (
        shouldMarkReady({
          draft: p.draft,
          pipelinePr: protectedEval.pipelinePr,
        })
      )
        try {
          graphql(
            `
              mutation ($id: ID!) {
                markPullRequestReadyForReview(input: { pullRequestId: $id }) {
                  pullRequest {
                    id
                  }
                }
              }
            `,
            { id: p.node_id },
          );
        } catch (e) {
          console.error(`approval: could not mark #${n} ready: ${e.message}`);
          stillDraft = true;
        }
      const url = previewUrl(OWNER, NAME, n);
      upsertBotComment(
        n,
        MARKERS.humanApproval,
        [
          `### Ready for human approval`,
          `CI is green, ${protectedEval.pipelinePr ? `Claude has reviewed \`${head.slice(0, 7)}\`, ` : ''}${requireCopilot() ? `Copilot has reviewed \`${head.slice(0, 7)}\`, ` : ''}all threads are resolved and \`${GATES_CONTEXT}\` is green.`,
          `**Preview:** ${url}`,
          `Code owners have been requested for review. Merging is a human decision; no agent can merge.`,
          stillDraft
            ? 'The pull request is still a draft: the pipeline could not mark it ready for review. Mark it ready yourself.'
            : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
      writeState(n, { ...state, humanApprovalFor: head });
    }
  },
};

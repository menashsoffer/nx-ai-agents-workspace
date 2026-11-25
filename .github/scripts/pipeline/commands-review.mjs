// commands-review: split from pipeline-pre.mjs (pure move).
import {
  api,
  OWNER,
  NAME,
  setOutput,
  list,
  reviewThreads,
  postComment,
} from '../github.mjs';
import {
  decideReviewRun,
  earlierFindings,
  checkReview,
  renderFindingComment,
  renderReviewBody,
  REVIEW_CONTEXT,
  reviewOutcome,
} from '../review-lib.mjs';
import {
  issueFromBranch,
  issueForAgents,
  parseFlags,
  renderOutcome,
  GATES_CONTEXT,
} from '../pipeline-lib.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import {
  botLogin,
  num,
  readIf,
  requireCopilot,
  reviewStateOf,
  runUrl,
  setGatesStatus,
  setStage,
} from './helpers.mjs';

export const reviewCommands = {
  // review.yml: whether to review this PR now (review-lib decideReviewRun).
  // Outputs `run` (true/false), `head` and `issue` (0 when the branch names
  // none). MANUAL=true for workflow_dispatch.
  'review-decide'([pr, runHeadSha]) {
    const n = num(pr);
    const p = api(`pulls/${n}`);
    const repo = `${OWNER}/${NAME}`;
    const decision = decideReviewRun({
      pr: p,
      runHeadSha: runHeadSha || null,
      isManual: process.env.MANUAL === 'true',
      reviewState: p.head?.sha
        ? reviewStateOf(api(`commits/${p.head.sha}/statuses?per_page=100`))
        : null,
      botLogin: botLogin(),
      repo,
    });
    console.log(
      `review-decide: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );
    const issue = issueFromBranch({
      headRef: p.head?.ref,
      headRepo: p.head?.repo?.full_name,
      repo,
    });
    setOutput('run', String(decision.action === 'review'));
    setOutput('head', decision.head ?? '');
    setOutput('issue', String(issue ?? 0));
  },

  // review.yml: the reviewer's untrusted data besides the PR and diff: the
  // issue with the bot's spec and plan, and the bot's earlier findings.
  'review-collect'([pr, issue, issueFile, findingsFile]) {
    const n = num(pr);
    const issueNumber = Number(issue);
    const data =
      Number.isInteger(issueNumber) && issueNumber > 0
        ? issueForAgents({
            issue: api(`issues/${issueNumber}`),
            comments: list(`issues/${issueNumber}/comments`),
            botLogin: botLogin(),
          })
        : { spec: null, plan: null, note: 'the branch names no issue' };
    writeFileSync(issueFile, JSON.stringify(data, null, 2));
    writeFileSync(
      findingsFile,
      JSON.stringify(earlierFindings(reviewThreads(n), botLogin()), null, 2),
    );
  },

  // review.yml publish job: posts the findings as review threads, sets
  // `pipeline/review` on the head and appends the outcome note, which
  // re-runs approval.yml. A failed run is a problem: stage:routing.
  'review-publish'([pr, head, ...rest]) {
    const n = num(pr);
    const f = parseFlags(rest);
    const p = api(`pulls/${n}`);
    if (p.state !== 'open' || p.head.sha !== head) {
      console.log(
        `review-publish: skipped (PR #${n} is closed or moved past ${String(head).slice(0, 7)})`,
      );
      return;
    }
    let check = checkReview({
      jobResult: f['job-result'],
      raw: readIf(f.result),
      diff: readFileSync(f.diff, 'utf8'),
    });
    let postError = null;
    if (check.verdict === 'findings') {
      try {
        const threadComment = (finding) =>
          renderFindingComment({ finding, head });
        api(`pulls/${n}/reviews`, {
          method: 'POST',
          body: {
            commit_id: head,
            event: 'COMMENT',
            body: renderReviewBody({ head, check }),
            comments: check.findings
              .filter((finding) => finding.anchor === 'line')
              .map((finding) => ({
                path: finding.path,
                line: finding.line,
                side: 'RIGHT',
                body: threadComment(finding),
              })),
          },
        });
        for (const finding of check.findings.filter((x) => x.anchor === 'file'))
          api(`pulls/${n}/comments`, {
            method: 'POST',
            body: {
              commit_id: head,
              path: finding.path,
              subject_type: 'file',
              body: threadComment(finding),
            },
          });
      } catch (e) {
        postError = e;
        check = {
          ...check,
          verdict: 'failed',
          problem: 'agent_error',
          details: [
            ...check.details,
            'Posting the findings failed; some review threads may be missing.',
          ],
        };
      }
    }
    const isFailed = check.verdict === 'failed';
    api(`statuses/${head}`, {
      method: 'POST',
      body: {
        context: REVIEW_CONTEXT,
        state: isFailed ? 'failure' : 'success',
        description: isFailed
          ? 'The Claude review failed; re-run Pipeline · Review'
          : check.verdict === 'clean'
            ? 'Clean: no findings'
            : `${check.findings.length} finding(s) posted as review threads`,
        target_url: runUrl() || undefined,
      },
    });
    const outcome = reviewOutcome({
      check,
      head,
      promptVersion: f['prompt-version'] ?? '',
    });
    postComment(n, renderOutcome({ ...outcome, run_url: runUrl(), item: n }));
    if (outcome.result === 'problem') setStage(n, 'stage:routing');
    setOutput('result', outcome.result);
    console.log(`review-publish: ${check.verdict} at ${head.slice(0, 7)}`);
    if (postError) throw postError;
  },

  // A new head has no `pipeline/gates` status, which blocks the merge. This
  // gives it a pending one right away so the PR says why it is waiting.
  // approval.yml (workflow_run on CI `requested`); never overwrites.
  'gates-pending'([pr, sha]) {
    const n = num(pr);
    const p = api(`pulls/${n}`);
    if (
      p.state !== 'open' ||
      p.head.sha !== sha ||
      p.head.repo?.full_name !== `${OWNER}/${NAME}`
    ) {
      console.log(
        `gates-pending: skipped (PR #${n} is closed, moved or a fork)`,
      );
      return;
    }
    const statuses = api(`commits/${sha}/statuses?per_page=100`);
    if (statuses.some((s) => s.context === GATES_CONTEXT)) return;
    setGatesStatus(
      sha,
      {
        state: 'pending',
        description: requireCopilot()
          ? 'Waiting for CI and the Copilot review'
          : 'Waiting for CI',
      },
      statuses,
    );
  },
};

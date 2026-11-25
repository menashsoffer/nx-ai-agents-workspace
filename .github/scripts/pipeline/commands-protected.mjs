// commands-protected: split from pipeline-pre.mjs (pure move).
import {
  parseFlags,
  isPipelineBranch,
  protectedOfCompare,
  renderProtectedRequest,
  latestProtectedRequest,
  decideProtectedCommand,
  renderApprovedPrBody,
  renderProtectedApprovedNote,
  PROTECTED_CONTEXT,
  issueFromBranch,
  needsProtectedRequest,
} from '../pipeline-lib.mjs';
import { api, setOutput, postComment, OWNER, NAME, list } from '../github.mjs';
import {
  botLogin,
  compareFiles,
  defaultBranch,
  num,
  ownerLogin,
  protectedEvaluation,
  readIf,
  say,
  setStage,
  setStatus,
  writeOutcome,
} from './helpers.mjs';

export const protectedCommands = {
  // develop.yml publish job, approvable case. The branch is already pushed
  // and NO PR exists: the protected content has not run anywhere. Posts the
  // approval request on the issue (protected paths with their full diff),
  // appends a `protected_approval_needed` outcome note and parks the issue
  // in stage:awaiting-approval. A branch that turns out to hold a
  // never-approvable path (or a file list that may be cut off) is deleted
  // and the step fails with `rejected=true` (the forbidden_path hard gate).
  'protected-request'(args) {
    const f = parseFlags(args);
    const n = num(f._[0]);
    const branch = f.branch;
    if (!isPipelineBranch(branch)) throw new Error('Not a pipeline branch');
    const base = defaultBranch();
    const head = api(`git/ref/heads/${branch}`).object.sha;
    const files = compareFiles(base, head);
    const changed = protectedOfCompare(files);
    if (
      !changed.complete ||
      changed.never.length ||
      !changed.protected.length
    ) {
      console.error(
        `protected-request: refused (never approvable: ${changed.never.join(', ') || '-'}; complete: ${changed.complete}; protected: ${changed.protected.length})`,
      );
      try {
        api(`git/refs/heads/${branch}`, { method: 'DELETE' });
      } catch {
        // already gone
      }
      setOutput('rejected', 'true');
      process.exit(1);
    }
    let result = {};
    try {
      result = JSON.parse(readIf(f.result) || '{}');
    } catch {
      result = {};
    }
    const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
    postComment(
      n,
      renderProtectedRequest({
        head,
        branch,
        compareUrl: `${server}/${OWNER}/${NAME}/compare/${base}...${branch}`,
        files,
        title: result.pr_title,
        body: result.pr_body,
      }),
    );
    writeOutcome(
      n,
      {
        stage: 'develop',
        result: 'problem',
        problem: 'protected_approval_needed',
        summary: `Branch ${branch} pushed at ${head.slice(0, 7)} without a PR: ${changed.protected.length} protected path(s) need the owner's approval.`,
        details: [
          `Protected paths: ${changed.protected.join(', ')}`,
          `The owner replies on this issue with /approve-protected ${head.slice(0, 12)} (or /reject-protected <reason>).`,
        ],
        prompt_version: f['prompt-version'] ?? '',
      },
      { route: false },
    );
    setStage(n, 'stage:awaiting-approval');
    setOutput('head', head);
  },

  // The owner's /approve-protected or /reject-protected on an issue
  // (protected-approve.yml, issue_comment created). The comment arrives
  // through the environment, as data: COMMENT_BODY, COMMENT_USER,
  // COMMENT_USER_TYPE. decideProtectedCommand checks everything; a comment
  // that cannot be honoured gets one short reply and changes nothing.
  // Approve: opens the PR (or, if one is already open for the branch,
  // records the approval on it), appends the record note, sets
  // `pipeline/protected-approval` = success and the issue's stage:building.
  // Reject: a `protected_rejected` outcome (the router hands it to a human);
  // the branch stays.
  'protected-decision'([number, commentId]) {
    const n = num(number);
    const cid = num(commentId);
    const bot = botLogin();
    const owner = ownerLogin();
    const item = api(`issues/${n}`);
    const fetched = api(`issues/comments/${cid}`);
    const refs = list(`git/matching-refs/heads/issue-${n}-`);
    const request = latestProtectedRequest(list(`issues/${n}/comments`), bot);
    const base = defaultBranch();
    let changed = null;
    if (request) {
      try {
        changed = protectedOfCompare(compareFiles(base, request.head));
      } catch {
        changed = null; // the commit is gone: decideProtectedCommand refuses
      }
    }
    const by = process.env.COMMENT_USER;
    const decision = decideProtectedCommand({
      comment: {
        body: process.env.COMMENT_BODY,
        login: by,
        type: process.env.COMMENT_USER_TYPE,
      },
      ownerLogin: owner,
      edited:
        fetched.updated_at !== fetched.created_at ||
        fetched.body !== process.env.COMMENT_BODY,
      issue: {
        state: item.state,
        isPullRequest: Boolean(item.pull_request),
        labels: item.labels.map((l) => l.name),
      },
      request,
      branchHeads: refs.map((r) => r.object.sha),
      changed,
    });
    console.log(
      `protected-decision: ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`,
    );
    if (decision.action === 'ignore') return;
    if (decision.action === 'reply') {
      postComment(n, `Not applied: ${say(decision.reason)}.`);
      return;
    }
    if (decision.action === 'reject') {
      writeOutcome(n, {
        stage: 'develop',
        result: 'problem',
        problem: 'protected_rejected',
        summary: `The owner rejected the protected changes at ${decision.head.slice(0, 7)}.`,
        details: [
          `Reason: ${decision.reason}`,
          'The branch is kept; nothing was merged and no PR was opened.',
        ],
      });
      return;
    }

    // approve
    const { head } = decision;
    const branch = refs
      .find((r) => r.object.sha === head)
      .ref.replace(/^refs\/heads\//, '');
    let pr = list('pulls?state=open').find(
      (x) =>
        x.head.ref === branch && x.head.repo?.full_name === `${OWNER}/${NAME}`,
    );
    if (!pr) {
      pr = api('pulls', {
        method: 'POST',
        body: {
          title: (request.pr?.title || `Issue #${n}`).slice(0, 250),
          head: branch,
          base,
          draft: true,
          body: renderApprovedPrBody({
            body: request.pr?.body,
            issue: n,
            protectedPaths: decision.protectedPaths,
            head,
            by,
          }),
        },
      });
      setStage(pr.number, 'stage:building');
    }
    // The note before the status: gates recompute from the notes.
    postComment(
      pr.number,
      renderProtectedApprovedNote({
        issue: n,
        pr: pr.number,
        head,
        paths: decision.paths,
        by,
        commentId: cid,
        protectedPaths: decision.protectedPaths,
      }),
    );
    setStatus(
      PROTECTED_CONTEXT,
      head,
      { state: 'success', description: `Approved by @${by}` },
      api(`commits/${head}/statuses?per_page=100`),
    );
    setStage(n, 'stage:building');
    postComment(
      n,
      `Approved by @${say(by)} for \`${head.slice(0, 7)}\`. PR #${pr.number} carries the protected changes; CI and the review gates run next.`,
    );
    setOutput('pr', String(pr.number));
  },

  // A pipeline PR's `pipeline/protected-approval` status, recomputed
  // (protected-approve.yml, workflow_run on CI `requested`: every new head).
  // Success when the PR has no protected path or the latest approval record
  // names this head and path set; pending otherwise, and then a new
  // approval request is posted on the issue for this head (unless the latest
  // request is already for it) and the issue returns to
  // stage:awaiting-approval.
  'protected-status'([pr, sha]) {
    const n = num(pr);
    const p = api(`pulls/${n}`);
    if (
      p.state !== 'open' ||
      p.head.sha !== sha ||
      p.head.repo?.full_name !== `${OWNER}/${NAME}`
    ) {
      console.log(
        `protected-status: skipped (PR #${n} is closed, moved or a fork)`,
      );
      return;
    }
    const head = p.head.sha;
    const evaluation = protectedEvaluation(p, list(`issues/${n}/comments`));
    console.log(
      `protected-status: ${evaluation.state} (${evaluation.description})`,
    );
    setStatus(
      PROTECTED_CONTEXT,
      head,
      evaluation,
      api(`commits/${head}/statuses?per_page=100`),
    );
    const issue = issueFromBranch({
      headRef: p.head.ref,
      headRepo: p.head.repo?.full_name,
      repo: `${OWNER}/${NAME}`,
    });
    if (!issue || !evaluation.pipelinePr) return;
    const request = latestProtectedRequest(
      list(`issues/${issue}/comments`),
      botLogin(),
    );
    if (!needsProtectedRequest({ evaluation, request, head })) return;
    const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
    postComment(
      issue,
      renderProtectedRequest({
        head,
        branch: p.head.ref,
        compareUrl: `${server}/${OWNER}/${NAME}/compare/${defaultBranch()}...${head}`,
        files: evaluation.files,
        title: p.title,
        body: '',
      }),
    );
    writeOutcome(
      issue,
      {
        stage: 'approval',
        result: 'problem',
        problem: 'protected_approval_needed',
        summary: `PR #${n} has a new commit ${head.slice(0, 7)} with protected changes: owner approval needed.`,
        details: [
          `Protected paths: ${evaluation.paths.join(', ')}`,
          `The owner replies on issue #${issue} with /approve-protected ${head.slice(0, 12)} (or /reject-protected <reason>).`,
        ],
      },
      { route: false },
    );
    setStage(issue, 'stage:awaiting-approval');
  },
};

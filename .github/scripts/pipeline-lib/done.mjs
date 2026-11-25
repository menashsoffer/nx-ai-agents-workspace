// done: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).
import { sameLogin } from './naming.mjs';
import { STAGES } from './constants.mjs';

// ---------------------------------------------------------------- done

const ISSUE_BRANCH = /^issue-([1-9]\d*)-/;

/**
 * The issue a PR's head branch names (`issue-<n>-<slug>`, see branchName),
 * or null. Same-repo branches only: a fork can name its branch anything.
 */
export function issueFromBranch({ headRef, headRepo, repo }) {
  if (!sameLogin(headRepo, repo)) return null;
  const m = ISSUE_BRANCH.exec(String(headRef ?? ''));
  return m ? Number(m[1]) : null;
}

// GitHub closes an issue a moment after the merge that closes it.
const MERGE_CLOSE_SKEW_MS = 60_000;

/**
 * Whether the issue found through issueFromBranch counts as linked: it
 * exists, is an issue (not a PR), and is open or was closed by this merge
 * (closed no earlier than a minute before the PR merged).
 */
export function branchIssueEligible({ issue, merged, mergedAt }) {
  if (!issue || issue.pull_request) return false;
  if (issue.state === 'open') return true;
  if (!merged || !issue.closed_at || !mergedAt) return false;
  return (
    Date.parse(issue.closed_at) >= Date.parse(mergedAt) - MERGE_CLOSE_SKEW_MS
  );
}

/**
 * What done.yml does when a PR closes. `issues` are the linked issues
 * (closingIssuesReferences, or the branch fallback), each with `state`
 * ('open' | 'closed') and `openPrs`: other open PRs linked to it.
 *
 * - merged: the PR and every linked issue get `stage:done` (no router). A
 *   PR with no linked issue and no stage label is not a pipeline item.
 * - closed unmerged: each still-open issue without a replacement PR gets a
 *   `pr_closed` outcome note (the router hands it to a human). The closed
 *   PR's stage labels are cleared. No linked issue: nothing.
 */
export function planPrClosed({ pr, issues = [] }) {
  const noop = (reason) => ({ act: false, reason, pr: null, issues: [] });
  if (pr.merged) {
    if (!issues.length && !pr.labels.some((l) => STAGES.includes(l)))
      return noop('no linked issue and no stage label');
    return {
      act: true,
      reason: 'merged',
      pr: { number: pr.number, labels: 'done' },
      issues: issues.map((i) => ({
        number: i.number,
        action: 'done',
        reason: 'merged',
      })),
    };
  }
  if (!issues.length) return noop('no linked issue');
  return {
    act: true,
    reason: 'closed without merging',
    pr: { number: pr.number, labels: 'clear' },
    issues: issues.map((i) => {
      const others = (i.openPrs ?? []).filter((n) => n !== pr.number);
      if (i.state !== 'open')
        return { number: i.number, action: 'skip', reason: 'issue is closed' };
      if (others.length)
        return {
          number: i.number,
          action: 'skip',
          reason: `replacement PR #${others[0]} is open`,
        };
      return { number: i.number, action: 'route', reason: 'no open PR left' };
    }),
  };
}

/** The `pr_closed` outcome note written on an issue whose PR was closed. */
export function prClosedOutcome({ pr, closedBy }) {
  const who = /^[A-Za-z0-9-]+(?:\[bot\])?$/.test(closedBy ?? '')
    ? `\`${closedBy}\``
    : 'an unknown user';
  return {
    stage: 'pr',
    result: 'problem',
    problem: 'pr_closed',
    summary: `PR #${pr} was closed without merging.`,
    details: [
      `PR #${pr} was closed by ${who}; its code is not on the default branch.`,
      'Reopen the PR, open a replacement PR, restart the issue (add `stage:planned` or an earlier stage label; re-developing force-pushes its `issue-<n>-` branch), or close the issue.',
    ],
  };
}

/**
 * Why the router must leave an item alone, or null. Closed issues and PRs
 * are finished; an open issue whose PR was closed still routes. An item in
 * stage:awaiting-approval waits for the owner and is never moved by the
 * router.
 */
export function routerSkip(item) {
  if (item?.state === 'closed') return `#${item.number} is closed`;
  const names = (item?.labels ?? []).map((l) =>
    typeof l === 'string' ? l : l?.name,
  );
  return names.includes('stage:awaiting-approval')
    ? `#${item.number} is awaiting the owner's approval of protected changes`
    : null;
}

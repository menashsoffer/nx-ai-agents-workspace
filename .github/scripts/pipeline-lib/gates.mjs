// gates: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).
import { MARKERS } from './constants.mjs';
import { isPipelinePr } from './naming.mjs';

// ---------------------------------------------------------------- gates

/** Statuses and check runs are `pipeline/gates`' inputs; this is its name. */
export const GATES_CONTEXT = 'pipeline/gates';

const CI_FAILED = ['failure', 'timed_out'];

/**
 * The review gates for one head commit, in order: ci, Claude review (only
 * when `reviewRequired`), review threads, Copilot review (only when
 * `requireCopilot`), protected-file approval.
 * Returns the checks and the value for the `pipeline/gates` commit status:
 * - `success`: every check holds;
 * - `failure`: a real blocker (ci failed, a required approval was refused);
 * - `pending` otherwise, its description naming the first missing check.
 *
 * `securityJobConclusion` is the `security` CI job's check run (undefined:
 * no such run);
 * `reviewRequired` is true for pipeline PRs; `reviewState` is the head's
 * `pipeline/review` status (review.yml): success once the review ran (clean
 * or with findings, which are review threads), failure when it failed;
 * `protectedRequired` / `protectedApprovalState` come from
 * evaluateProtectedApproval (`required`, `state`). `requireCopilot`
 * (parseRequireCopilot, the REQUIRE_COPILOT variable) turns the Copilot
 * gate on; off, that check is a success saying so, whatever Copilot did.
 */
export function evaluateGates({
  ciConclusion,
  securityJobConclusion,
  reviewRequired = false,
  reviewState = null,
  unresolvedThreads = 0,
  copilotReviewedHead = false,
  requireCopilot = false,
  protectedRequired = false,
  protectedApprovalState = null,
}) {
  const ok = (key, label, detail = 'ok') => ({
    key,
    label,
    state: 'success',
    detail,
  });
  const wait = (key, label, detail) => ({
    key,
    label,
    state: 'pending',
    detail,
  });
  const fail = (key, label, detail) => ({
    key,
    label,
    state: 'failure',
    detail,
  });

  const ci = (() => {
    if (CI_FAILED.includes(ciConclusion)) return fail('ci', 'CI', 'ci failed');
    if (ciConclusion !== 'success')
      return wait('ci', 'CI', `ci is ${ciConclusion ?? 'missing'}`);
    if (securityJobConclusion === undefined) return ok('ci', 'CI');
    if (securityJobConclusion === 'success') return ok('ci', 'CI');
    if (CI_FAILED.includes(securityJobConclusion))
      return fail('ci', 'CI', 'the security job failed');
    return wait(
      'ci',
      'CI',
      `the security job is ${securityJobConclusion ?? 'running'}`,
    );
  })();

  const reviewLabel = 'Claude review';
  const review = !reviewRequired
    ? ok('review', reviewLabel, 'not a pipeline PR')
    : reviewState === 'success'
      ? ok('review', reviewLabel, 'reviewed this commit')
      : reviewState === 'failure' || reviewState === 'error'
        ? fail(
            'review',
            reviewLabel,
            'the review run failed; re-run Pipeline · Review',
          )
        : wait('review', reviewLabel, 'not reviewed this commit yet');

  const threads =
    unresolvedThreads > 0
      ? wait(
          'threads',
          'Review threads',
          `${unresolvedThreads} unresolved review thread(s)`,
        )
      : ok('threads', 'Review threads', 'none open');

  const copilot = !requireCopilot
    ? ok('copilot', 'Copilot review', 'not required (REQUIRE_COPILOT off)')
    : copilotReviewedHead
      ? ok('copilot', 'Copilot review', 'reviewed this commit')
      : wait(
          'copilot',
          'Copilot review',
          'Copilot has not reviewed this commit',
        );

  // `pipeline/protected-approval` (evaluateProtectedApproval): needed only
  // when the PR touches protected paths; then it must be success.
  const protectedLabel = 'Protected-file approval';
  const protectedApproval = !protectedRequired
    ? ok('protected-approval', protectedLabel, 'no protected paths')
    : protectedApprovalState === 'success'
      ? ok('protected-approval', protectedLabel, 'approved by the owner')
      : protectedApprovalState === 'failure' ||
          protectedApprovalState === 'error'
        ? fail(
            'protected-approval',
            protectedLabel,
            `approval is ${protectedApprovalState}`,
          )
        : wait(
            'protected-approval',
            protectedLabel,
            protectedApprovalState === 'pending'
              ? 'waiting for the owner to approve the protected changes'
              : 'the approval status is not set yet',
          );

  const checks = [ci, review, threads, copilot, protectedApproval];
  const failed = checks.find((c) => c.state === 'failure');
  const missing = checks.find((c) => c.state !== 'success');
  const blocker = failed ?? missing;
  return {
    state: failed ? 'failure' : missing ? 'pending' : 'success',
    description: blocker
      ? `${blocker.label}: ${blocker.detail}`
      : `${[
          'CI',
          ...(reviewRequired ? [reviewLabel] : []),
          ...(requireCopilot ? ['Copilot review'] : []),
          'threads',
        ]
          .join(', ')
          .replace(/, ([^,]*)$/, ' and $1')} all satisfied`,
    blockedBy: blocker?.key ?? null,
    checks,
  };
}

const gateCell = (text, max = 120) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/<!--/g, '&lt;!--')
    .replace(/</g, '&lt;')
    .replace(/\|/g, '\\|')
    .replace(/@/g, '@​')
    .trim()
    .slice(0, max);

const GATE_ICON = { success: '✅', pending: '⏳', failure: '❌' };

/**
 * The one upserted "Review gates" comment: every gate for the head, the
 * findings still open (with the ids /disposition takes) and the
 * dispositions on record. All text from findings and reasons is escaped.
 */
export function renderGatesComment({
  head,
  gates,
  open = [],
  dispositions = [],
}) {
  const lines = [
    MARKERS.gates,
    `### Review gates for \`${String(head).slice(0, 7)}\` ${GATE_ICON[gates.state]}`,
    `The \`pipeline/gates\` commit status is **${gates.state}**: ${gateCell(gates.description, 200)}`,
    '',
    '| gate | state | detail |',
    '| --- | --- | --- |',
    ...gates.checks.map(
      (c) => `| ${c.label} | ${GATE_ICON[c.state]} | ${gateCell(c.detail)} |`,
    ),
  ];
  if (open.length) {
    lines.push(
      '',
      '**Open findings.** Fix them, or the repo owner records a decision with one comment line per finding: `/disposition <id> <accepted-risk|false-positive|out-of-scope> <reason, 10+ characters>`.',
      '',
      '| id | source | where / what |',
      '| --- | --- | --- |',
      ...open.map((f) => `| \`${f.id}\` | ${f.source} | ${gateCell(f.text)} |`),
    );
  }
  if (dispositions.length) {
    lines.push(
      '',
      '**Dispositions.**',
      '',
      '| id | kind | by | reason |',
      '| --- | --- | --- | --- |',
      ...dispositions.map(
        (d) =>
          `| \`${d.id}\` | ${d.kind} | ${gateCell(d.by, 40)} | ${gateCell(d.reason, 100)} |`,
      ),
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- ci

/**
 * Reaction to a failed CI run: a `ci_failed` outcome (the router takes it
 * from there), only for an open pipeline PR and only if the run is for the
 * PR's current head (older runs are stale).
 */
export function decideCiFailed({ pr, runHeadSha, botLogin, repo }) {
  if (pr.state !== 'open') return { action: 'noop', reason: 'PR is not open' };
  if (
    !isPipelinePr({
      author: pr.user?.login,
      headRef: pr.head?.ref,
      headRepo: pr.head?.repo?.full_name,
      repo,
      botLogin,
    })
  )
    return { action: 'noop', reason: 'not a pipeline PR' };
  if (pr.head?.sha !== runHeadSha)
    return { action: 'noop', reason: 'CI run is for an older commit' };
  return { action: 'outcome', problem: 'ci_failed' };
}

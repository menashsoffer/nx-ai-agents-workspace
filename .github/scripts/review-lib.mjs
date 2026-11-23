// Pure decision logic of the independent Claude review stage (review.yml):
// which head to review, checking the reviewer's findings against the diff,
// and the texts the bot posts. Unit-tested in review-lib.test.mjs; the I/O
// is in pipeline.mjs (review-decide, review-collect, review-publish). docs/pipeline-review.md, "Claude review".
import {
  MARKERS,
  isPipelinePr,
  normalizeOutcome,
  unquoteCPath,
} from './pipeline-lib.mjs';

/** Commit status the publish job sets on the reviewed head. */
export const REVIEW_CONTEXT = 'pipeline/review';

/** At most this many findings are posted per head; the rest are dropped. */
export const REVIEW_MAX_FINDINGS = 5;

export const REVIEW_CATEGORIES = [
  'requirement',
  'test',
  'correctness',
  'security',
];

const SHA = /^[0-9a-f]{40}$/;

/**
 * Whether review.yml reviews this PR now. Pipeline PRs only (manual and
 * Dependabot PRs are skipped), open, and once per head: the head's
 * `pipeline/review` status (`reviewState`) is unset. A CI run for an older
 * commit is stale. A manual run (`isManual`, workflow_dispatch) reviews the
 * current head again unless that head already has a successful review.
 */
export function decideReviewRun({
  pr,
  runHeadSha = null,
  isManual = false,
  reviewState = null,
  botLogin,
  repo,
}) {
  const skip = (reason) => ({ action: 'skip', reason });
  if (pr.state !== 'open') return skip('PR is not open');
  if (
    !isPipelinePr({
      author: pr.user?.login,
      headRef: pr.head?.ref,
      headRepo: pr.head?.repo?.full_name,
      repo,
      botLogin,
    })
  )
    return skip('not a pipeline PR');
  const head = pr.head?.sha;
  if (!SHA.test(String(head))) return skip('PR head is not a commit SHA');
  if (!isManual && runHeadSha !== head)
    return skip('CI run is for an older commit');
  if (reviewState === 'success') return skip('this commit is already reviewed');
  if (reviewState && !isManual)
    return skip(`this commit already has a review (${reviewState})`);
  return { action: 'review', head };
}

/** A diff path token (`b/x`, `"b/x"` or `/dev/null`) as a repo path, or null. */
function diffPath(token) {
  const raw = token.startsWith('"') ? unquoteCPath(token) : token;
  if (!raw || raw === '/dev/null' || !raw.startsWith('b/')) return null;
  return raw.slice(2);
}

/**
 * The lines a review comment can anchor to, per file: the new-side (RIGHT)
 * line numbers of every added or context line in a unified diff. Deleted
 * files have no entry.
 */
export function diffRightLines(diff) {
  const files = new Map();
  let lines = null;
  let next = 0;
  for (const line of String(diff ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      lines = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = diffPath(line.slice(4).replace(/\t.*$/, ''));
      lines = path ? (files.get(path) ?? new Set()) : null;
      if (path) files.set(path, lines);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (!lines || next === 0) continue;
    if (line.startsWith('+') || line.startsWith(' ')) lines.add(next++);
  }
  return files;
}

/** Single-line text from the agent, without markers or @-pings. */
function inert(text, max) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/<!--/g, '&lt;!--')
    .replace(/@/g, '@​')
    .trim()
    .slice(0, max);
}

const failed = (problem, details = []) => ({
  verdict: 'failed',
  problem,
  summary: '',
  findings: [],
  details,
});

/** A finding from the agent, or the reason it is unusable. */
function checkFinding(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'is not an object' };
  const { path, line, category, title, scenario } = raw;
  if (typeof path !== 'string' || !path.trim()) return { error: 'has no path' };
  if (!Number.isInteger(line) || line < 1)
    return { error: 'has no line number' };
  if (!REVIEW_CATEGORIES.includes(category))
    return { error: 'has an unknown category' };
  if (typeof title !== 'string' || !title.trim())
    return { error: 'has no title' };
  if (typeof scenario !== 'string' || scenario.trim().length < 20)
    return { error: 'has no concrete failure scenario' };
  return {
    finding: {
      path: path.trim().replace(/^\.?\//, ''),
      line,
      category,
      title: inert(title, 150),
      scenario: inert(scenario, 1200),
    },
  };
}

/**
 * The reviewer's result, checked. `jobResult` is the agent job's result,
 * `raw` its structured output, `diff` the PR's unified diff. Verdicts:
 * - `clean`: no usable finding (findings outside the diff are dropped and
 *   listed in `details`);
 * - `findings`: up to REVIEW_MAX_FINDINGS findings, each anchored to a diff
 *   line (`anchor: 'line'`) or, when its line is not in the diff, to the file
 *   (`anchor: 'file'`);
 * - `failed`: the run failed (`agent_error`) or its output is unusable
 *   (`invalid_output`).
 */
export function checkReview({ jobResult, raw, diff }) {
  if (jobResult !== 'success')
    return failed('agent_error', [`The review job ended as ${jobResult}.`]);
  let result;
  try {
    result = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return failed('invalid_output', ['The review output is not JSON.']);
  }
  if (!result || typeof result !== 'object')
    return failed('invalid_output', ['The review output is not an object.']);
  const { status, summary, findings } = result;
  if (!['clean', 'findings'].includes(status) || !Array.isArray(findings))
    return failed('invalid_output', ['The review output has no valid status.']);
  if ((status === 'clean') !== (findings.length === 0))
    return failed('invalid_output', [
      'The review status and its findings disagree.',
    ]);
  const lines = diffRightLines(diff);
  const kept = [];
  const details = [];
  for (const [index, entry] of findings.entries()) {
    const { finding, error } = checkFinding(entry);
    if (error)
      return failed('invalid_output', [`Finding ${index + 1} ${error}.`]);
    const fileLines = lines.get(finding.path);
    if (!fileLines) {
      details.push(
        `Dropped a finding on ${inert(finding.path, 200)}: the file is not changed in this PR.`,
      );
      continue;
    }
    if (kept.length >= REVIEW_MAX_FINDINGS) {
      details.push(
        `Dropped a finding on ${finding.path}:${finding.line}: more than ${REVIEW_MAX_FINDINGS} findings.`,
      );
      continue;
    }
    kept.push({
      ...finding,
      anchor: fileLines.has(finding.line) ? 'line' : 'file',
    });
  }
  return {
    verdict: kept.length ? 'findings' : 'clean',
    problem: 'none',
    summary: inert(summary, 300),
    findings: kept,
    details,
  };
}

/** The top comment of one finding's review thread. */
export function renderFindingComment({ finding, head }) {
  const where =
    finding.anchor === 'file'
      ? `\n\n_Line ${finding.line} is outside the diff, so this comment is on the file._`
      : '';
  return [
    `${MARKERS.reviewFinding} head=${head} category=${finding.category} -->`,
    `**${finding.title}** (${finding.category})`,
    '',
    `${finding.scenario}${where}`,
    '',
    'Fix it in a new commit, or the repo owner records a decision as a reply in this thread: `/disposition <accepted-risk|false-positive|out-of-scope> <reason>`.',
  ].join('\n');
}

/** The body of the PR review that carries the finding threads. */
export function renderReviewBody({ head, check }) {
  return [
    `### Claude review of \`${head.slice(0, 7)}\``,
    check.summary || 'The reviewer gave no summary.',
    '',
    `${check.findings.length} finding(s). Each one is a review thread; \`pipeline/gates\` waits until every thread is resolved or dispositioned.`,
  ].join('\n');
}

/** The outcome note (stage `review`) for one checked review. */
export function reviewOutcome({ check, head, promptVersion = '' }) {
  const short = head.slice(0, 7);
  const base = { stage: 'review', prompt_version: promptVersion };
  if (check.verdict === 'failed')
    return normalizeOutcome({
      ...base,
      result: 'problem',
      problem: check.problem,
      summary: `Review stopped at ${short}: no review was posted.`,
      details: check.details,
    });
  return normalizeOutcome({
    ...base,
    result: 'success',
    summary:
      check.verdict === 'clean'
        ? `review: clean at ${short}.`
        : `review: ${check.findings.length} finding(s) at ${short}.`,
    details: check.details,
  });
}

/**
 * Earlier findings of the bot on this PR, for the reviewer: where they are,
 * what they said and whether they are resolved, so that a resolved or
 * dispositioned finding is not raised again unchanged.
 */
export function earlierFindings(threads, botLogin) {
  return threads
    .filter(
      (t) =>
        String(t.first?.author ?? '').toLowerCase() ===
          String(botLogin ?? '').toLowerCase() &&
        String(t.first?.body ?? '').startsWith(MARKERS.reviewFinding),
    )
    .map((t) => ({
      path: t.path ?? null,
      line: t.line ?? null,
      resolved: Boolean(t.isResolved),
      text: inert(t.first.body.replace(/^<!--[^\n]*-->\n/, ''), 1500),
    }));
}

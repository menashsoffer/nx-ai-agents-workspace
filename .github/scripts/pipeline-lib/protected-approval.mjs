// pipeline-lib/protected-approval: one concern of the pipeline decision logic (see ../pipeline-lib.mjs).
import {
  classifyProtectedPaths,
  comparePaths,
  pathSetHash,
} from './patches.mjs';
import { lastJsonFence } from './outcomes.mjs';
import { sameLogin } from './naming.mjs';
import { MARKERS } from './constants.mjs';
import { neutraliseMarkers } from './comments.mjs';

// ---------------------------------------------------------------- protected approval

// The owner's approval of protected (approvable) changes: docs/pipeline.md,
// "Protected-change approval". develop.yml pushes the branch WITHOUT a PR and
// posts a request on the issue; the owner answers with one command comment.
// The approval is bound to the issue, the branch head SHA and the set of
// protected paths, so any later push invalidates it.

/** Status context set on the head: success once the owner approved it. */
export const PROTECTED_CONTEXT = 'pipeline/protected-approval';

export const APPROVE_COMMAND = '/approve-protected';

export const REJECT_COMMAND = '/reject-protected';

export const HEAD_PREFIX_LENGTH = 12;

export const PROTECTED_MIN_REASON = 10;

const PROTECTED_MAX_REASON = 500;

// GitHub rejects comments over 65536 characters; leave room for the frame.
export const COMMENT_LIMIT = 64_000;

export const PR_BODY_LIMIT = 8_000;

/**
 * The protected paths of a compare response's `files`, classified:
 * `{ approvable, never, protected, complete, hash }`. `hash` binds the whole
 * protected set (pathSetHash). `complete` is false when the file list may be
 * cut off (COMPARE_FILE_LIMIT): the result must then not be trusted.
 */
export function protectedOfCompare(files) {
  const { paths, complete } = comparePaths(files);
  const cls = classifyProtectedPaths(paths);
  return { ...cls, complete, hash: pathSetHash(cls.protected) };
}

/**
 * Parses a comment as an approval command. The whole body must be exactly
 *   /approve-protected <first 12 hex characters of the head commit>
 * or
 *   /reject-protected <reason, 10+ characters>
 * on one line and nothing else. A comment that starts with neither command
 * is `{ ok: false, ignore: true }` (ordinary discussion). The body is data:
 * error texts never repeat it.
 */
export function parseProtectedCommand(body) {
  const text = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  const approve = /^\/approve-protected(?:\s|$)/.test(text);
  const reject = /^\/reject-protected(?:\s|$)/.test(text);
  if (!approve && !reject) return { ok: false, ignore: true };
  if (text.includes('\n'))
    return {
      ok: false,
      error: 'the comment must be exactly one command, with no other text',
    };
  if (approve) {
    const m = /^\/approve-protected[ \t]+([0-9a-f]{12})$/.exec(text);
    if (!m)
      return {
        ok: false,
        error: `expected \`${APPROVE_COMMAND} <first ${HEAD_PREFIX_LENGTH} hex characters of the head commit>\``,
      };
    return { ok: true, kind: 'approve', prefix: m[1] };
  }
  const m = /^\/reject-protected[ \t]+(\S.*)$/.exec(text);
  if (!m)
    return {
      ok: false,
      error: `expected \`${REJECT_COMMAND} <reason>\``,
    };
  const reason = m[1].trim();
  if ([...reason].length < PROTECTED_MIN_REASON)
    return {
      ok: false,
      error: `the reason must be at least ${PROTECTED_MIN_REASON} characters`,
    };
  if (reason.length > PROTECTED_MAX_REASON)
    return {
      ok: false,
      error: `the reason must be at most ${PROTECTED_MAX_REASON} characters`,
    };
  return { ok: true, kind: 'reject', reason };
}

export const htmlText = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One-line JSON that survives the single-line json-fence reader. */
export const jsonLine = (value) =>
  JSON.stringify(value).replace(
    /[\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16)}`,
  );

/** Lock files last: their diffs are long and the least interesting. */
export const lockLast = (a, b) =>
  Number(/pnpm-lock\.yaml$/.test(a.filename)) -
    Number(/pnpm-lock\.yaml$/.test(b.filename)) ||
  a.filename.localeCompare(b.filename);

const REQUEST_HEADER =
  /^<!-- pipeline:protected-approval head=([0-9a-f]{40}) paths=([0-9a-f]{64}) -->\n/;

/** Reads a request comment: `{ head, paths, pr }` or null. */
export function parseProtectedRequest(body) {
  const text = String(body ?? '');
  const m = REQUEST_HEADER.exec(text);
  if (!m) return null;
  const { value } = lastJsonFence(text);
  const pr =
    value?.v === 1 &&
    typeof value.title === 'string' &&
    typeof value.body === 'string'
      ? { title: value.title, body: value.body }
      : null;
  return { head: m[1], paths: m[2], pr };
}

/** The latest request written by the pipeline bot on an issue's comments. */
export function latestProtectedRequest(comments, botLogin) {
  if (!botLogin) return null;
  let latest = null;
  for (const c of comments) {
    if (!sameLogin(c.user?.login, botLogin)) continue;
    const req = parseProtectedRequest(c.body);
    if (req) latest = { ...req, commentId: c.id };
  }
  return latest;
}

/**
 * The bot's record of an approval, written on the PR (appended, never
 * edited). The marker line is the binding: issue, PR, head, path-set hash,
 * who and which comment.
 */
export function renderProtectedApprovedNote({
  issue,
  pr,
  head,
  paths,
  by,
  commentId,
  protectedPaths,
}) {
  return [
    `${MARKERS.protectedApproved} issue=${issue} pr=${pr} head=${head} paths=${paths} by=${by} comment=${commentId} -->`,
    `Protected changes approved by @${by} for \`${String(head).slice(0, 7)}\` (issue #${issue}). Approved paths:`,
    '',
    ...protectedPaths.map(
      (p) => `- \`${neutraliseMarkers(p).replace(/`/g, '')}\``,
    ),
    '',
    'The approval covers this commit only: a later push needs a new one.',
  ].join('\n');
}

const APPROVED_HEADER =
  /^<!-- pipeline:protected-approved issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) paths=([0-9a-f]{64}) by=([\w.[\]-]+) comment=(\d+) -->\n/;

/** The approval records the pipeline bot wrote, oldest first. */
export function parseProtectedApprovedNotes(comments, botLogin) {
  const out = [];
  for (const c of comments) {
    if (!sameLogin(c.user?.login, botLogin)) continue;
    const m = APPROVED_HEADER.exec(String(c.body ?? ''));
    if (!m) continue;
    out.push({
      issue: Number(m[1]),
      pr: Number(m[2]),
      head: m[3],
      paths: m[4],
      by: m[5],
      commentId: Number(m[6]),
    });
  }
  return out;
}

/**
 * The state of `pipeline/protected-approval` for one PR head, from the
 * PR's changed files (`files`, a compare response) and the approval records
 * (`notes`, parseProtectedApprovedNotes). Recomputed on every evaluation, so
 * a push after the approval is pending again.
 * - not a pipeline PR: `success` (a person's own PR is covered by the
 *   code-owner review), `required: false`;
 * - no protected path: `success`, `required: false`;
 * - a never-approvable path, or a file list that may be cut off: `failure`;
 * - the latest owner record names this head and this path set: `success`;
 * - otherwise `pending`.
 */
export function evaluateProtectedApproval({
  pipelinePr,
  head,
  files,
  notes = [],
  ownerLogin,
}) {
  const out = (state, description, required, changed = {}) => ({
    state,
    description,
    required,
    paths: changed.protected ?? [],
    hash: changed.hash ?? null,
  });
  if (!pipelinePr)
    return out(
      'success',
      'Not a pipeline PR: the code owner reviews it',
      false,
    );
  const changed = protectedOfCompare(files);
  if (!changed.complete)
    return out(
      'failure',
      'The changed files cannot be listed completely (300 or more)',
      true,
      changed,
    );
  if (!changed.protected.length)
    return out('success', 'No protected paths', false, changed);
  if (changed.never.length)
    return out(
      'failure',
      `Not approvable, only a local session may change: ${changed.never.join(', ')}`,
      true,
      changed,
    );
  const latest = notes.filter((n) => sameLogin(n.by, ownerLogin)).at(-1);
  if (latest && latest.head === head && latest.paths === changed.hash)
    return out('success', `Approved by @${latest.by}`, true, changed);
  return out(
    'pending',
    `Waiting for the owner: ${APPROVE_COMMAND} ${head.slice(0, HEAD_PREFIX_LENGTH)}`,
    true,
    changed,
  );
}

/**
 * Whether an approval request must be (re)posted on the issue: protected
 * changes wait for approval and the latest request is not for this head.
 */
export const needsProtectedRequest = ({ evaluation, request, head }) =>
  evaluation.state === 'pending' && request?.head !== head;

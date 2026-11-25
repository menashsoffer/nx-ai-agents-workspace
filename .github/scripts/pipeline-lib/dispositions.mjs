// dispositions: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).
import { short } from './state.mjs';
import { sameLogin } from './naming.mjs';
import { neutraliseMarkers } from './comments.mjs';
import { COPILOT_LOGINS, MARKERS } from './constants.mjs';

// ---------------------------------------------------------------- dispositions

export const DISPOSITION_KINDS = [
  'accepted-risk',
  'false-positive',
  'out-of-scope',
];

const DISPOSITION_MIN_REASON = 10;

const DISPOSITION_MAX_REASON = 500;

const DISPOSITION_MAX_LINES = 20;

// `C-<n>` is the Copilot review thread whose top comment has database id n;
// `R-<n>` is a Claude review finding thread (review.yml), likewise.
const FINDING_ID = /^[CR]-\d{1,15}$/;

/** Id of a Copilot review thread: `C-` + its top comment's database id. */
export const copilotThreadId = (topCommentId) => `C-${topCommentId}`;

/** Id of a Claude review finding thread: `R-` + its top comment's database id. */
const reviewThreadId = (topCommentId) => `R-${topCommentId}`;

const QUOTE_LINE = /^ {0,3}>/;

const COMMAND_LINE = /^[ \t]{0,3}\/disposition(?:\s|$)/m;

/** Why a /disposition that is not the first thing in a comment is refused. */
export const DISPOSITION_MISPLACED =
  'the command must be the first thing in the comment (a quote block above it is fine). Post it again as a new comment';

/** Why a /disposition inside a thread that is not a finding is refused. */
export const DISPOSITION_NOT_A_FINDING =
  'this thread is not a review finding; use a top-level PR comment';

/**
 * Parses a comment as a /disposition command. A quote block at the top of
 * the body (lines starting with `>`, as GitHub's "Quote reply" writes them)
 * and blank lines around it are dropped first. The rest must be one or more
 * lines of exactly
 *   /disposition <finding-id> <accepted-risk|false-positive|out-of-scope> <reason, 10+ characters>
 * and one bad line rejects all of them. A comment that has no such line is
 * `{ ok: false, ignore: true }` (ordinary discussion, also a mention in
 * backticks or mid-sentence); one where a line starts with /disposition but
 * something else comes before it is an error, so the owner is told instead
 * of left with silence.
 *
 * `thread` is set for a reply inside a review thread: `{ id }` is the id of
 * the finding the thread is about, or null when it is not a finding thread.
 * There the id may be left out (`/disposition <kind> <reason>`), a given id
 * must be the thread's, and there is one command per reply.
 *
 * The body is data: nothing from it is executed, and error texts never
 * repeat it, except for ids that already matched the id format.
 */
export function parseDispositionComment(body, { thread } = {}) {
  const all = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let start = 0;
  while (
    start < all.length &&
    (all[start].trim() === '' || QUOTE_LINE.test(all[start]))
  )
    start++;
  const text = all.slice(start).join('\n').trim();
  if (!/^\/disposition(?:\s|$)/.test(text))
    return COMMAND_LINE.test(text)
      ? { ok: false, error: DISPOSITION_MISPLACED }
      : { ok: false, ignore: true };
  if (thread && !thread.id)
    return { ok: false, error: DISPOSITION_NOT_A_FINDING };
  const lines = text.split('\n').map((l) => l.trimEnd());
  if (lines.length > DISPOSITION_MAX_LINES)
    return {
      ok: false,
      error: `at most ${DISPOSITION_MAX_LINES} commands per comment`,
    };
  if (thread && lines.length > 1)
    return { ok: false, error: 'one command per reply in a review thread' };
  const fail = (i, why) => ({
    ok: false,
    error: lines.length > 1 ? `line ${i + 1}: ${why}` : why,
  });
  const commands = [];
  for (const [i, line] of lines.entries()) {
    const short = new RegExp(
      `^/disposition[ \\t]+(${DISPOSITION_KINDS.join('|')})[ \\t]+(\\S[\\s\\S]*)$`,
    ).exec(line);
    if (short && !thread)
      return fail(
        i,
        "the short form without an id works only as a reply inside a finding's review thread",
      );
    const m = short
      ? [line, thread.id, short[1], short[2]]
      : /^\/disposition[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S[\s\S]*)$/.exec(line);
    if (!m)
      return fail(
        i,
        thread
          ? 'expected `/disposition <accepted-risk|false-positive|out-of-scope> <reason>`'
          : 'expected `/disposition <finding-id> <accepted-risk|false-positive|out-of-scope> <reason>`',
      );
    const [, id, kind, reason] = m;
    if (!FINDING_ID.test(id))
      return fail(i, 'the finding id must look like C-123456 or R-123456');
    if (thread && id !== thread.id)
      return fail(i, `this thread is ${thread.id}; the command names ${id}`);
    if (!DISPOSITION_KINDS.includes(kind))
      return fail(i, `the kind must be one of ${DISPOSITION_KINDS.join(', ')}`);
    if ([...reason].length < DISPOSITION_MIN_REASON)
      return fail(
        i,
        `the reason must be at least ${DISPOSITION_MIN_REASON} characters`,
      );
    if (reason.length > DISPOSITION_MAX_REASON)
      return fail(
        i,
        `the reason must be at most ${DISPOSITION_MAX_REASON} characters`,
      );
    if (commands.some((c) => c.id === id))
      return fail(i, `${id} appears twice`);
    commands.push({ id, kind, reason });
  }
  return { ok: true, commands };
}

/**
 * The review thread a comment belongs to: the one listing the comment, else
 * (a thread whose comment list was cut short) the one whose comments include
 * the comment it replies to. `threads` are classifyThreads entries.
 */
export function threadOfComment(threads, { commentId, inReplyTo = null }) {
  const has = (t, id) => t.thread.commentIds.includes(id);
  return (
    threads.find((t) => has(t, commentId)) ??
    (inReplyTo ? threads.find((t) => has(t, inReplyTo)) : undefined) ??
    null
  );
}

/**
 * Who may disposition: the repo owner (`vars.PIPELINE_OWNER_LOGIN`) acting
 * as a human. Not author_association, not the PR or issue author. An unset
 * variable means nobody can.
 */
export function checkDispositionAuthor({ login, type, ownerLogin }) {
  if (!ownerLogin)
    return { ok: false, reason: 'PIPELINE_OWNER_LOGIN is not set' };
  if (type !== 'User')
    return { ok: false, reason: 'the commenter is not a user' };
  if (!sameLogin(login, ownerLogin))
    return { ok: false, reason: 'the commenter is not the pipeline owner' };
  return { ok: true };
}

/**
 * Checks parsed commands against what can be dispositioned right now: open
 * Copilot and Claude review finding threads (`findingIds`). One unknown id
 * rejects all.
 */
export function validateDispositions({ commands, findingIds = new Set() }) {
  for (const { id } of commands) {
    if (!findingIds.has(id))
      return { ok: false, error: `${id} is not an open review finding thread` };
  }
  return { ok: true };
}

/** A backtick fence longer than any run of backticks inside `text`. */
export const fenceFor = (text) =>
  '`'.repeat(
    Math.max(
      3,
      ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length + 1),
    ),
  );

/**
 * The bot's record of a disposition (appended, never edited). The marker
 * line carries the binding: finding id, kind, the head the owner saw, who
 * and which comment. The reason is data in a fenced block.
 */
export function renderDispositionNote({
  id,
  kind,
  head,
  by,
  commentId,
  reason,
}) {
  const text = neutraliseMarkers(reason);
  const fence = fenceFor(text);
  return [
    `${MARKERS.disposition} id=${id} kind=${kind} head=${head} by=${by} comment=${commentId} -->`,
    `Disposition recorded: \`${id}\` as **${kind}** by @${by} at \`${String(head).slice(0, 7)}\`.`,
    '',
    `${fence}text`,
    text,
    fence,
  ].join('\n');
}

const DISPOSITION_HEADER =
  /^<!-- pipeline:disposition id=([CR]-\d{1,15}) kind=(accepted-risk|false-positive|out-of-scope) head=([0-9a-f]{7,40}) by=([\w.[\]-]+) comment=(\d+) -->\n/;

/**
 * The disposition records written by the pipeline bot. Anyone can paste a
 * marker into a comment, so only the bot's own comments count.
 */
export function parseDispositionNotes(comments, botLogin) {
  const out = [];
  for (const c of comments) {
    if (!sameLogin(c.user?.login, botLogin)) continue;
    const m = DISPOSITION_HEADER.exec(String(c.body ?? ''));
    if (!m) continue;
    const reason = /\n(`{3,})text\n([\s\S]*?)\n\1\s*$/.exec(c.body)?.[2] ?? '';
    out.push({
      id: m[1],
      kind: m[2],
      head: m[3],
      by: m[4],
      commentId: Number(m[5]),
      reason,
    });
  }
  return out;
}

/**
 * Dispositions in effect, as thread id -> kind (the latest record wins). A
 * record counts only if the owner made it (`by` is the pipeline owner; with
 * no owner, none count).
 */
export function dispositionKinds({ records, ownerLogin }) {
  return new Map(
    records
      .filter((r) => sameLogin(r.by, ownerLogin))
      .map((r) => [r.id, r.kind]),
  );
}

/**
 * Sorts review threads into the ones the owner can disposition. `threads`
 * come from github.mjs reviewThreads (with `first` = the top comment).
 * Copilot threads start with a Copilot comment; Claude review threads start
 * with a finding comment by the pipeline bot (`botLogin`). Both have an id a
 * disposition can name; other threads (people) are only counted.
 */
export function classifyThreads(threads, { botLogin } = {}) {
  return threads.map((t) => {
    const first = t.first ?? {};
    if (COPILOT_LOGINS.some((l) => sameLogin(l, first.author)))
      return { source: 'copilot', id: copilotThreadId(first.id), thread: t };
    if (
      sameLogin(first.author, botLogin) &&
      String(first.body ?? '').startsWith(MARKERS.reviewFinding)
    )
      return { source: 'review', id: reviewThreadId(first.id), thread: t };
    return { source: 'other', id: null, thread: t };
  });
}

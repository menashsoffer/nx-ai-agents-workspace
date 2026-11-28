// pipeline-lib/restart: one concern of the pipeline decision logic (see ../pipeline-lib.mjs).
import { MARKERS, STAGES } from './constants.mjs';
import { MAX_LIFETIME_RESETS, emptyState } from './state.mjs';
import { clean } from './outcomes.mjs';
import { checkDispositionAuthor } from './dispositions.mjs';
import { sameLogin, stageEdits } from './naming.mjs';

// ---------------------------------------------------------------- restart

/** `/restart <stage>` -> the stage label it sets. */
export const RESTART_STAGES = Object.freeze({
  qualified: 'stage:qualified',
  planned: 'stage:planned',
});

export const RESTART_MIN_REASON = 10;

export const RESTART_MAX_REASON = 300;

const RESTART_USAGE =
  'expected `/restart <qualified|planned> <reason, 10+ characters>`';

/**
 * Parses a comment as the /restart command. The whole body must be exactly
 *   /restart <qualified|planned> <reason, 10+ characters>
 * on one line. A comment that does not start with /restart is
 * `{ ok: false, ignore: true }` (ordinary discussion). The body is data:
 * nothing from it is executed, and error texts never repeat it.
 */
export function parseRestartComment(body) {
  const text = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!/^\/restart(?:\s|$)/.test(text)) return { ok: false, ignore: true };
  const m = /^\/restart[ \t]+(\S+)[ \t]+(\S[^\n]*)$/.exec(text);
  if (!m) return { ok: false, error: RESTART_USAGE };
  const [, stage, reason] = m;
  if (!Object.hasOwn(RESTART_STAGES, stage))
    return {
      ok: false,
      error: `the stage must be one of ${Object.keys(RESTART_STAGES).join(', ')}`,
    };
  const trimmed = reason.trimEnd();
  if ([...trimmed].length < RESTART_MIN_REASON)
    return {
      ok: false,
      error: `the reason must be at least ${RESTART_MIN_REASON} characters`,
    };
  if (trimmed.length > RESTART_MAX_REASON)
    return {
      ok: false,
      error: `the reason must be at most ${RESTART_MAX_REASON} characters`,
    };
  return { ok: true, stage, reason: trimmed };
}

/**
 * The route note the bot appends for an accepted restart, on the issue whose
 * loop restarts. collectRouterInput reads it back: routeWindow counts route
 * notes only after the latest one.
 */
function renderRestartNote({ attempt, count }) {
  return [
    `${MARKERS.route} restart attempt=${attempt.id} count=${count}/${MAX_LIFETIME_RESETS} -->`,
    `**Restarted at \`${RESTART_STAGES[attempt.stage]}\` by ${clean(attempt.by, 60)} (lifetime restart ${count}/${MAX_LIFETIME_RESETS}).** The loop budget of this item starts again here.`,
    '',
    'Reason:',
    '',
    '```text',
    clean(attempt.reason, RESTART_MAX_REASON).replace(/`/g, "'"),
    '```',
  ].join('\n');
}

/** Strictly parses a restart route note (see renderRestartNote). */
export function parseRestartNote(body) {
  const m =
    /^<!-- pipeline:route restart attempt=(a[1-9]\d*-[1-9]\d*) count=([1-9]\d*)\/([1-9]\d*) -->(?:\n|$)/.exec(
      String(body ?? ''),
    );
  if (!m) return { ok: false, error: 'not a restart note' };
  return {
    ok: true,
    route: { target: 'restart', attempt: m[1], count: Number(m[2]) },
  };
}

/**
 * What to do with a comment on an issue that might be a /restart command.
 * Pure. Returns `{ action }`:
 * - `ignore`: not for us (no owner configured, not a command, a bot);
 * - `reply` + `reason`: a command that cannot be honoured; nothing changes.
 *   With `limit: true` the reason is the whole reply text;
 * - `restart` + `stage`, `attempt`, `state` (the issue's next state), `note`
 *   (the route note to append) and `edit` (the issue's label edit).
 * Checks, in order: commenter (the owner, a User), one exact command, the
 * comment was not edited, an open issue, the issue is in
 * stage:needs-attention, it has no open pull request and finally the
 * lifetime limit (`state.resetCount` < MAX_LIFETIME_RESETS).
 *
 * `comment` is `{ id, body, login, type, createdAt }`; `issue` is `{ number,
 * state, isPullRequest, labels }`; `state` the issue's parsed state;
 * `pullRequests` the open pipeline PRs on this issue's branch, `{ number }`
 * each.
 */
export function decideRestart({
  comment,
  ownerLogin,
  edited = false,
  issue,
  state = emptyState(),
  pullRequests = [],
}) {
  const reply = (reason) => ({ action: 'reply', reason });
  if (!ownerLogin) return { action: 'ignore', reason: 'no owner configured' };
  const parsed = parseRestartComment(comment?.body);
  if (parsed.ignore)
    return { action: 'ignore', reason: 'not a restart command' };
  const author = checkDispositionAuthor({
    login: comment?.login,
    type: comment?.type,
    ownerLogin,
  });
  if (!author.ok) {
    return comment?.type === 'User'
      ? reply(author.reason)
      : { action: 'ignore', reason: author.reason };
  }
  if (!parsed.ok) return reply(parsed.error);
  if (edited)
    return reply('the comment was edited after it was posted; post it again');
  if (issue?.isPullRequest)
    return reply('this is a pull request: comment on its issue instead');
  if (issue?.state !== 'open') return reply('the issue is closed');

  const { stage, reason } = parsed;
  if (!issue.labels?.includes('stage:needs-attention'))
    return reply('the issue is not in stage:needs-attention');
  if (pullRequests.length)
    return reply(
      `pull request #${pullRequests[0].number} is still open for this issue: close it first`,
    );
  const edit = stageEdits(issue.labels, RESTART_STAGES[stage]);
  if (state.resetCount >= MAX_LIFETIME_RESETS)
    return {
      action: 'reply',
      limit: true,
      reason: `Lifetime restart limit (${MAX_LIFETIME_RESETS}) reached; close the issue or fix it in a local session.`,
    };

  const count = state.resetCount + 1;
  const attempt = {
    id: `a${count}-${comment.id}`,
    at: String(comment.createdAt ?? ''),
    by: String(comment.login),
    reason,
    stage,
  };
  return {
    action: 'restart',
    stage,
    attempt,
    count,
    state: {
      ...state,
      resetCount: count,
      attempts: [...state.attempts, attempt],
    },
    edit,
    note: renderRestartNote({ attempt, count }),
  };
}

/**
 * Whether the bot should point a person to /restart after they moved an
 * item out of stage:needs-attention by hand (`{ post }`; the text is
 * renderRestartHint). Pure.
 * `action` is the label event: `unlabeled` of stage:needs-attention, or
 * `labeled` with another stage label while the item still carries
 * stage:needs-attention. `labels` are the item's labels now; `comments` its
 * comments, oldest first. One note per parking: none if the bot already
 * posted one after its latest route to a human.
 */
export function decideRestartHint({
  action,
  label,
  labels = [],
  comments = [],
  botLogin,
}) {
  const parked = 'stage:needs-attention';
  const movedOut =
    action === 'unlabeled'
      ? label === parked && !labels.includes(parked)
      : action === 'labeled'
        ? STAGES.includes(label) &&
          ![parked, 'stage:routing', 'stage:done'].includes(label) &&
          labels.includes(parked)
        : false;
  if (!movedOut)
    return { post: false, reason: 'not a hand move out of a park' };
  const notes = comments.filter((c) => sameLogin(c.user?.login, botLogin));
  const lastHuman = notes.findLastIndex(
    (c) =>
      String(c.body ?? '').startsWith(MARKERS.route) &&
      /^<!-- pipeline:route [^\n]*\btarget=human\b/.test(c.body),
  );
  const lastHint = notes.findLastIndex((c) =>
    String(c.body ?? '').startsWith(MARKERS.restartHint),
  );
  if (lastHint > lastHuman)
    return { post: false, reason: 'already pointed to /restart' };
  return { post: true };
}

export function renderRestartHint() {
  return [
    MARKERS.restartHint,
    `\`stage:needs-attention\` was changed by hand. That does **not** open a fresh loop budget: this item keeps the budget it already used, so its next problem goes straight back to a human.`,
    `To restart it on purpose, the repo owner comments on the issue: \`/restart <qualified|planned> <reason, 10+ characters>\`. An issue gets ${MAX_LIFETIME_RESETS} restarts in its lifetime.`,
  ].join('\n\n');
}

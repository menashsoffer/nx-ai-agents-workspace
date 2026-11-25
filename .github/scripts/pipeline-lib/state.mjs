// pipeline-lib/state: one concern of the pipeline decision logic (see ../pipeline-lib.mjs).
import { MARKERS } from './constants.mjs';

// ---------------------------------------------------------------- state

const STATE_DATA = /<!-- pipeline-state-data\n([\s\S]*?)\n-->/;

/**
 * Restarts one issue may ever get (see decideRestart). A lifetime limit: the
 * counter is never decremented or cleared, so after this many the item is
 * parked for good.
 */
export const MAX_LIFETIME_RESETS = 3;

export function emptyState() {
  return {
    copilotRequestedFor: null,
    humanApprovalFor: null,
    // Lifetime /restart counter of an ISSUE, written only by the bot's
    // restart command and never decremented or cleared. `attempts` lists
    // every accepted restart: { id, at, by, reason, stage }.
    resetCount: 0,
    attempts: [],
  };
}

const RESTART_ATTEMPT_KEYS = ['id', 'at', 'by', 'reason', 'stage'];

/** The valid attempt records of a parsed state (bad entries are dropped). */
const sanitizeAttempts = (value) =>
  (Array.isArray(value) ? value : [])
    .filter(
      (a) =>
        a &&
        typeof a === 'object' &&
        RESTART_ATTEMPT_KEYS.every((k) => typeof a[k] === 'string' && a[k]),
    )
    .map((a) => Object.fromEntries(RESTART_ATTEMPT_KEYS.map((k) => [k, a[k]])));

/**
 * Parses the state comment. Old state has no restart fields, and bad values
 * fall back to 0 / []; fields this version does not know are dropped. The
 * counter is never below the number of recorded attempts, so a damaged
 * `resetCount` cannot hand out free restarts.
 */
export function parseState(body) {
  const m = STATE_DATA.exec(String(body ?? ''));
  if (!m) return emptyState();
  try {
    const raw = JSON.parse(m[1]);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return emptyState();
    const attempts = sanitizeAttempts(raw.attempts);
    const count =
      Number.isSafeInteger(raw.resetCount) && raw.resetCount > 0
        ? raw.resetCount
        : 0;
    return {
      ...emptyState(),
      copilotRequestedFor: raw.copilotRequestedFor ?? null,
      humanApprovalFor: raw.humanApprovalFor ?? null,
      resetCount: Math.max(count, attempts.length),
      attempts,
    };
  } catch {
    return emptyState();
  }
}

/**
 * `requireCopilot: false` shows "not required" for the Copilot cell (the
 * gate is off, REQUIRE_COPILOT); leave it out to show the requested sha.
 */
export function renderState(state, labels = [], { requireCopilot } = {}) {
  const stage = labels.find((l) => l.startsWith('stage:')) ?? '-';
  return [
    MARKERS.state,
    '**Pipeline state.** Managed by automation. Please do not edit.',
    '',
    `| stage | Copilot requested for | human approval for |`,
    `| --- | --- | --- |`,
    `| \`${stage}\` | ${requireCopilot === false ? 'not required' : short(state.copilotRequestedFor)} | ${short(state.humanApprovalFor)} |`,
    '',
    `lifetime resets: ${state.resetCount ?? 0}/${MAX_LIFETIME_RESETS} · latest attempt: ${state.attempts?.length ? `\`${state.attempts.at(-1).id}\`` : '-'}`,
    '',
    // `<`/`>` only occur inside JSON strings: escaped, so text such as a
    // restart reason can neither end the HTML comment nor start a marker.
    `<!-- pipeline-state-data\n${JSON.stringify(state).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n-->`,
  ].join('\n');
}

const short = (sha) => (sha ? `\`${sha.slice(0, 7)}\`` : '-');

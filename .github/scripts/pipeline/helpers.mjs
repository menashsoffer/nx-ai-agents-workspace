// pipeline/helpers: part of the pipeline CLI (see ../pipeline.mjs).
import {
  findComment,
  upsertComment,
  labelsOf,
  editLabels,
  postComment,
  setOutput,
  api,
  OWNER,
  NAME,
} from '../github.mjs';
import {
  MARKERS,
  parseState,
  emptyState,
  parseRequireCopilot,
  renderState,
  stageTransition,
  normalizeOutcome,
  renderOutcome,
  GATES_CONTEXT,
  isPipelinePr,
  evaluateProtectedApproval,
  parseProtectedApprovedNotes,
} from '../pipeline-lib.mjs';
import { REVIEW_CONTEXT } from '../review-lib.mjs';
import { readFileSync } from 'node:fs';

export const many = (v) => (v === undefined ? [] : [].concat(v));

export const num = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`Expected a number, got ${v}`);
  return n;
};

/** The pipeline App's bot login (`vars.PIPELINE_BOT_LOGIN`). Required. */
export function botLogin() {
  const login = process.env.PIPELINE_BOT_LOGIN;
  if (!login) throw new Error('PIPELINE_BOT_LOGIN is not set');
  return login;
}

/** Marker comments are trusted only when the pipeline bot wrote them. */
export const findBotComment = (number, marker) =>
  findComment(number, marker, { author: botLogin() });

export const upsertBotComment = (number, marker, body) =>
  upsertComment(number, marker, body, { author: botLogin() });

// ------------------------------------------------------------ state
export function readState(pr) {
  const c = findBotComment(pr, MARKERS.state);
  return c ? parseState(c.body) : emptyState();
}

/** `vars.REQUIRE_COPILOT`: only the exact string `true` turns the gate on. */
export const requireCopilot = () =>
  parseRequireCopilot(process.env.REQUIRE_COPILOT);

export function writeState(pr, state, labels = labelsOf(pr)) {
  upsertBotComment(
    pr,
    MARKERS.state,
    renderState(state, labels, { requireCopilot: requireCopilot() }),
  );
}

export function setStage(number, stage) {
  editLabels(number, stageTransition(labelsOf(number), stage));
}

// ------------------------------------------------------------ outcomes
export function runUrl() {
  const { RUN_URL, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } =
    process.env;
  if (RUN_URL) return RUN_URL;
  return GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : '';
}

/**
 * Appends an outcome note. A problem hands the item to the router
 * (stage:routing); on success the caller moves to the next stage itself.
 * With `{ route: false }` a problem sets no stage either: for the one
 * problem that parks the item for a person (`protected_approval_needed`).
 */
export function writeOutcome(number, input, { route = true } = {}) {
  const outcome = normalizeOutcome({
    ...input,
    run_url: input.run_url || runUrl(),
    item: number,
  });
  postComment(number, renderOutcome(outcome));
  if (route) {
    if (outcome.result === 'problem') setStage(number, 'stage:routing');
  }
  setOutput('result', outcome.result);
  setOutput('problem', outcome.problem);
  return outcome;
}

// ------------------------------------------------------------ gates
export /**
 * `vars.PIPELINE_OWNER_LOGIN`: the only person whose /disposition counts.
 * Empty when unset, and then no disposition is valid.
 */
const ownerLogin = () => process.env.PIPELINE_OWNER_LOGIN ?? '';

/**
 * Sets a commit status on `sha` unless its latest value for `context` is
 * already this one. `statuses` are the commit's statuses, newest first.
 */
export function setStatus(context, sha, { state, description }, statuses) {
  const current = statuses.find((s) => s.context === context);
  const text = description.slice(0, 140);
  if (current?.state === state && current.description === text) return;
  api(`statuses/${sha}`, {
    method: 'POST',
    body: { state, context, description: text },
  });
}

export const setGatesStatus = (sha, gates, statuses) =>
  setStatus(GATES_CONTEXT, sha, gates, statuses);

/** The head's latest `pipeline/review` state (review.yml), or null. */
export const reviewStateOf = (statuses) =>
  statuses.find((s) => s.context === REVIEW_CONTEXT)?.state ?? null;

// ------------------------------------------------------------ protected approval
export const defaultBranch = () =>
  process.env.DEFAULT_BRANCH || api('').default_branch;

/** Files of `base...head` (the compare API lists at most 300; see comparePaths). */
export const compareFiles = (base, head) =>
  api(`compare/${base}...${head}`).files ?? [];

/** Bot text for a comment: no pings, no pipeline markers. */
export const say = (text) =>
  String(text)
    .replace(/<!--/g, '&lt;!--')
    .replace(/@/g, `@${String.fromCharCode(0x200b)}`)
    .slice(0, 500);

/**
 * The `pipeline/protected-approval` evaluation of an open same-repo PR:
 * recomputed from the changed files and the bot's approval records, never
 * read back from a status.
 */
export function protectedEvaluation(p, comments) {
  const pipelinePr = isPipelinePr({
    author: p.user?.login,
    headRef: p.head?.ref,
    headRepo: p.head?.repo?.full_name,
    repo: `${OWNER}/${NAME}`,
    botLogin: botLogin(),
  });
  const files = pipelinePr ? compareFiles(defaultBranch(), p.head.sha) : [];
  return {
    ...evaluateProtectedApproval({
      pipelinePr,
      head: p.head.sha,
      files,
      notes: parseProtectedApprovedNotes(comments, botLogin()),
      ownerLogin: ownerLogin(),
    }),
    pipelinePr,
    files,
  };
}

export const readIf = (path) => (path ? readFileSync(path, 'utf8') : '');

// pipeline-lib/naming: one concern of the pipeline decision logic (see ../pipeline-lib.mjs).
import { STAGES } from './constants.mjs';

// ---------------------------------------------------------------- labels

/** Labels to add/remove so that `target` is the only stage label. */
export function stageTransition(currentLabels, target) {
  if (!STAGES.includes(target)) throw new Error(`Unknown stage: ${target}`);
  return {
    add: currentLabels.includes(target) ? [] : [target],
    remove: currentLabels.filter((l) => STAGES.includes(l) && l !== target),
  };
}

/**
 * The board's "in progress" status label (set by people, not the pipeline).
 * A product that names it differently sets the STATUS_LABEL_IN_PROGRESS
 * environment variable in its workflows.
 */
export const STATUS_IN_PROGRESS =
  process.env.STATUS_LABEL_IN_PROGRESS || 'סטטוס: בעבודה';

/**
 * The board's "waiting for the owner" status label. Override with
 * STATUS_LABEL_WAITING_FOR_OWNER (for example to name the owner).
 */
export const STATUS_WAITING_FOR_OWNER =
  process.env.STATUS_LABEL_WAITING_FOR_OWNER || 'סטטוס: ממתין לבעלים';

/**
 * Edits that keep the board's status label true to the stage. An item that
 * stops at stage:needs-attention is waiting for the owner, not in progress;
 * when the owner restarts it, it is in progress again; a finished item is no
 * longer in progress. Items without the in-progress label are left alone
 * (unless they come back from stage:needs-attention with the waiting label),
 * so repositories that do not use these labels see no change.
 */
export function statusLabelEdits(currentLabels, target) {
  const none = { add: [], remove: [] };
  const hasLabel = (l) => currentLabels.includes(l);
  if (hasLabel(STATUS_IN_PROGRESS)) {
    if (target === 'stage:needs-attention')
      return { add: [STATUS_WAITING_FOR_OWNER], remove: [STATUS_IN_PROGRESS] };
    if (target === 'stage:done')
      return { add: [], remove: [STATUS_IN_PROGRESS] };
    return none;
  }
  const isResumed = ['stage:qualified', 'stage:planned'].includes(target);
  if (
    isResumed &&
    hasLabel('stage:needs-attention') &&
    hasLabel(STATUS_WAITING_FOR_OWNER)
  )
    return { add: [STATUS_IN_PROGRESS], remove: [STATUS_WAITING_FOR_OWNER] };
  return none;
}

/** The stage transition plus the status label edits that go with it. */
export function stageEdits(currentLabels, target) {
  const stage = stageTransition(currentLabels, target);
  const status = statusLabelEdits(currentLabels, target);
  return {
    add: [...stage.add, ...status.add],
    remove: [...stage.remove, ...status.remove],
  };
}

/**
 * Label edits that leave no stage: for a PR closed without merging, which no
 * stage may pick up again.
 */
export function clearStages(labels) {
  return {
    add: [],
    remove: labels.filter((l) => STAGES.includes(l)),
  };
}

/** `labels` after `editLabels(..., { add, remove })`. */
export const applyLabels = (labels, { add = [], remove = [] }) => [
  ...new Set([...labels.filter((l) => !remove.includes(l)), ...add]),
];

// Stages in which automation must leave a PR alone.
export function parkedIn(labels) {
  return ['stage:needs-attention', 'stage:routing'].find((l) =>
    labels.includes(l),
  );
}

// ---------------------------------------------------------------- naming

function slugify(text, max = 40) {
  const slug = String(text ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'task';
}

/** Branch for an issue: `issue-<n>-<slug>`. Titles in Hebrew slug to "task". */
export function branchName(issueNumber, title) {
  const n = Number(issueNumber);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Bad issue number');
  return `issue-${n}-${slugify(title)}`;
}

export const PIPELINE_BRANCH = /^issue-[1-9]\d*-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True for `issue-<n>-<slug>` (see branchName). */
export const isPipelineBranch = (name) =>
  PIPELINE_BRANCH.test(String(name ?? ''));

/** GitHub logins are case-insensitive. */
export const sameLogin = (a, b) =>
  Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Whether the hand-off to human approval marks a draft PR ready for review:
 * only a PR the pipeline opened as a draft itself. A person's own draft stays
 * a draft (their call), and the App cannot convert it anyway: the GraphQL
 * mutation answers "Resource not accessible by integration".
 */
export const shouldMarkReady = ({ draft, pipelinePr }) =>
  Boolean(draft && pipelinePr);

/**
 * True only for PRs the pipeline opened: authored by the pipeline App's bot
 * and on an `issue-<n>-<slug>` branch (see branchName) in this repository.
 */
export function isPipelinePr({ author, headRef, headRepo, repo, botLogin }) {
  return (
    sameLogin(author, botLogin) &&
    PIPELINE_BRANCH.test(String(headRef ?? '')) &&
    (headRepo === undefined || sameLogin(headRepo, repo))
  );
}

export function previewUrl(owner, repo, prNumber) {
  return `https://${owner.toLowerCase()}.github.io/${repo}/pr-${prNumber}/`;
}

// ---------------------------------------------------------------- prompts

/** Reads the `version:` field from a prompt's front matter. */
export function promptVersion(promptText) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(promptText);
  const v = fm && /^version:\s*(\S+)/m.exec(fm[1]);
  return v ? v[1] : 'unversioned';
}

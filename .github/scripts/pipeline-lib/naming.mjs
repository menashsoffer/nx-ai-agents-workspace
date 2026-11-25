// naming: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).
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

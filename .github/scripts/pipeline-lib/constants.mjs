// constants: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).

export const STAGES = [
  'stage:inbox',
  'stage:qualified',
  // Deprecated: nothing sets it any more (spec + plan is one stage, started
  // by stage:qualified). Kept so old items still show on the board.
  'stage:spec',
  'stage:planned',
  // Protected (approvable) changes are pushed to a branch, with no PR yet;
  // the issue waits here for the owner's /approve-protected. The router
  // never moves an item out of it (see routerSkip).
  'stage:awaiting-approval',
  'stage:building',
  'stage:human-approval',
  'stage:routing',
  'stage:needs-attention',
  // Terminal: the PR merged. Set only by done.yml, on the PR and its issues.
  'stage:done',
];

/** Project "Status" option name for every stage label. */
export const STAGE_STATUS = {
  'stage:inbox': 'Inbox',
  'stage:qualified': 'Qualified',
  'stage:spec': 'Spec', // deprecated, see STAGES
  'stage:planned': 'Planned',
  'stage:awaiting-approval': 'Awaiting approval',
  'stage:building': 'Building',
  'stage:human-approval': 'Human approval',
  'stage:routing': 'Routing',
  'stage:needs-attention': 'Needs attention',
  'stage:done': 'Done',
};

export const MARKERS = {
  state: '<!-- pipeline-state -->',
  spec: '<!-- pipeline:spec -->',
  plan: '<!-- pipeline:plan -->',
  preview: '<!-- pipeline:preview -->',
  humanApproval: '<!-- pipeline:human-approval -->',
  // Outcome and route notes carry attributes, so these are prefixes. Both
  // are append-only history: never upserted, never edited.
  outcome: '<!-- pipeline:outcome',
  route: '<!-- pipeline:route',
  // Prefix with attributes: the bot's record of an owner's /disposition command.
  disposition: '<!-- pipeline:disposition',
  // The bot's one-line answer inside a review thread where the owner posted
  // /disposition.
  dispositionReply: '<!-- pipeline:disposition-reply -->',
  // Prefixes with attributes. `protectedApproval` is the bot's approval
  // request on an issue (one per pushed head); `protectedApproved` is its
  // record of the owner's /approve-protected, written on the PR.
  protectedApproval: '<!-- pipeline:protected-approval',
  protectedApproved: '<!-- pipeline:protected-approved',
  // One upserted comment per PR: the review gates and their open findings.
  gates: '<!-- pipeline:gates -->',
  // Prefix with attributes: the top comment of a review thread the pipeline
  // bot opened for one finding of the Claude review (review.yml).
  reviewFinding: '<!-- pipeline:review-finding',
  // The one-time pointer to /restart after a person moved an item out of
  // stage:needs-attention by hand (see decideRestartHint).
  restartHint: '<!-- pipeline:restart-hint -->',
};

export const COPILOT_REVIEWER = 'copilot-pull-request-reviewer[bot]';

export const COPILOT_LOGINS = [COPILOT_REVIEWER, 'Copilot'];

// Agent-produced patches may not carry these without a human. The pipeline's
// own workflows, prompts and scripts are the trust boundary. Package
// manifests, the lockfile and pnpm/npm/git config are the execution surface
// of every later `pnpm` run, so dependency and script changes need a human.
//
// Two kinds of protected path (docs/pipeline.md, "Protected-change
// approval"):
// - approvable (APPROVABLE_PATH_PATTERNS): the owner may approve them once,
//   before any PR exists, with /approve-protected;
// - never approvable: everything else here. A patch that touches one is the
//   `forbidden_path` hard gate, and only a local session may change it.
const NEVER_APPROVABLE_PATH_PATTERNS = [
  /^\.github\//,
  /(^|\/)CODEOWNERS$/,
  /^\.pipeline\//,
  /^\.claude\//,
  /^\.codex\//,
  // Security gates.
  /^tools\/security\//,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.gitmodules$/,
];

// Run by pre-approved commands (`pnpm new:*`, `pnpm verify` ->
// pipeline:map:check) or by every `pnpm install`/`pnpm run`.
export const APPROVABLE_PATH_PATTERNS = [
  /^tools\/workspace-plugin\//,
  /^tools\/pipeline-map\//,
  /(^|\/)package\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)pnpm-workspace\.yaml$/,
];

// Approvable patterns are members of this array (same objects), so the
// subset relation holds by construction; a test also asserts it.
export const FORBIDDEN_PATH_PATTERNS = [
  ...NEVER_APPROVABLE_PATH_PATTERNS,
  ...APPROVABLE_PATH_PATTERNS,
];

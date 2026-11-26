// Pure, dependency-free decision logic for the multi-agent pipeline.
// Everything here is deterministic and unit-tested (pipeline-lib/*.test.mjs);
// I/O lives in github.mjs and the CLI in pipeline.mjs. This file only
// re-exports the modules in pipeline-lib/, one per concern.

export {
  APPROVABLE_PATH_PATTERNS,
  COPILOT_LOGINS,
  COPILOT_REVIEWER,
  FORBIDDEN_PATH_PATTERNS,
  MARKERS,
  STAGES,
  STAGE_STATUS,
} from './pipeline-lib/constants.mjs';
export {
  applyLabels,
  branchName,
  clearStages,
  isPipelineBranch,
  isPipelinePr,
  previewUrl,
  promptVersion,
  shouldMarkReady,
  stageTransition,
} from './pipeline-lib/naming.mjs';
export { parseFlags, renderPrompt } from './pipeline-lib/prompts.mjs';
export {
  COMPARE_FILE_LIMIT,
  checkPatch,
  classifyPatch,
  classifyProtectedPaths,
  comparePaths,
  forbiddenPaths,
  patchPaths,
  pathSetHash,
  unquoteCPath,
} from './pipeline-lib/patches.mjs';
export { branchPushTriggers } from './pipeline-lib/push-guard.mjs';
export {
  MAX_LIFETIME_RESETS,
  emptyState,
  parseState,
  renderState,
} from './pipeline-lib/state.mjs';
export { findMarkerComment, issueForAgents } from './pipeline-lib/comments.mjs';
export {
  DISPOSITION_KINDS,
  DISPOSITION_MISPLACED,
  DISPOSITION_NOT_A_FINDING,
  checkDispositionAuthor,
  classifyThreads,
  copilotThreadId,
  dispositionKinds,
  parseDispositionComment,
  parseDispositionNotes,
  renderDispositionNote,
  threadOfComment,
  validateDispositions,
} from './pipeline-lib/dispositions.mjs';
export {
  APPROVE_COMMAND,
  PROTECTED_CONTEXT,
  REJECT_COMMAND,
  evaluateProtectedApproval,
  latestProtectedRequest,
  needsProtectedRequest,
  parseProtectedApprovedNotes,
  parseProtectedCommand,
  parseProtectedRequest,
  protectedOfCompare,
  renderProtectedApprovedNote,
} from './pipeline-lib/protected-approval.mjs';
export {
  decideProtectedCommand,
  renderApprovedPrBody,
  renderProtectedRequest,
} from './pipeline-lib/protected-render.mjs';
export {
  GATES_CONTEXT,
  decideCiFailed,
  evaluateGates,
  renderGatesComment,
} from './pipeline-lib/gates.mjs';
export {
  evaluateApproval,
  parseRequireCopilot,
} from './pipeline-lib/approval.mjs';
export {
  branchIssueEligible,
  issueFromBranch,
  planPrClosed,
  prClosedOutcome,
  routerSkip,
} from './pipeline-lib/done.mjs';
export {
  HARD_GATES,
  OUTCOME_STAGES,
  PROBLEMS,
  normalizeOutcome,
  parseOutcome,
  renderOutcome,
} from './pipeline-lib/outcomes.mjs';
export {
  LEGACY_ROUTE_TARGETS,
  ROUTER_CAPS,
  ROUTE_TARGETS,
  TARGET_STAGE,
  allowedTargets,
  decideByRules,
  routeWindow,
  targetStage,
} from './pipeline-lib/router-rules.mjs';
export {
  chooseDecision,
  clampDecision,
  collectRouterInput,
  parseRoute,
  planRoute,
  renderRoute,
} from './pipeline-lib/router.mjs';
export {
  RESTART_MAX_REASON,
  RESTART_MIN_REASON,
  RESTART_STAGES,
  decideRestart,
  decideRestartHint,
  parseRestartComment,
  parseRestartNote,
  renderRestartHint,
} from './pipeline-lib/restart.mjs';
export {
  PLAN_AGENT_PROBLEMS,
  PLAN_MAX_FILES,
  PLAN_MAX_LINES,
  evaluatePlanApproval,
} from './pipeline-lib/plan-approval.mjs';
export {
  classifyDevelop,
  classifyPlan,
  renderPlanComment,
  renderSpecComment,
} from './pipeline-lib/plan-comments.mjs';
export { COMMAND_EFFECTS } from './pipeline-lib/command-effects.mjs';

// router-rules: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).
import { HARD_GATES, PROBLEM_TEXT } from './outcomes.mjs';

// ---------------------------------------------------------------- router

/** Where the router can send work next. Never `stage:routing` itself. */
export const ROUTE_TARGETS = ['replan', 'redevelop', 'human'];

/**
 * Old route notes may name a target that no longer exists. Reading one maps
 * it to today's target (a re-spec is now a re-plan: one stage writes both).
 */
export const LEGACY_ROUTE_TARGETS = Object.freeze({ respec: 'replan' });

/** Loop budgets per target, and in total, counted per item (see routeWindow). */
export const ROUTER_CAPS = Object.freeze({
  replan: 2,
  redevelop: 1,
  global: 5,
});

/** An external brain's pick is used only at or above this confidence. */
export const EXTERNAL_MIN_CONFIDENCE = 0.8;

/** Stage label each target sets. */
export const TARGET_STAGE = {
  // plan.yml (spec + plan) starts on stage:qualified.
  replan: 'stage:qualified',
  redevelop: 'stage:planned',
  human: 'stage:needs-attention',
};

export function targetStage(target) {
  return TARGET_STAGE[target] ?? TARGET_STAGE.human;
}

// The rules table (docs/pipeline.md "Router"). Anything not listed: human.
const RULES = [
  // Legacy spec-stage notes (spec.yml is gone): still routable.
  {
    stage: 'spec',
    problems: ['invalid_output'],
    target: 'replan',
    reason:
      'the old spec stage failed; re-run the combined spec and plan stage',
  },
  {
    stage: 'spec',
    problems: ['agent_error'],
    target: 'human',
    reason: 'the old spec stage failed, see run',
  },
  {
    stage: 'plan',
    problems: ['agent_error', 'invalid_output'],
    target: 'replan',
    reason: 'the planner failed or returned invalid output',
  },
  {
    stage: 'plan',
    problems: ['spec_missing', 'untestable_criteria'],
    target: 'replan',
    reason:
      'legacy note: the spec was missing or untestable; re-run the combined stage',
  },
  // A person must answer or split; a retry would only repeat the question.
  {
    stage: 'plan',
    problems: ['spec_questions'],
    target: 'human',
    reason: 'the issue is unclear: someone must answer the questions',
  },
  {
    stage: 'plan',
    problems: ['scope_split'],
    target: 'human',
    reason: 'the work is too big for one PR: split the issue',
  },
  {
    stage: 'develop',
    problems: ['verify_failed', 'agent_error'],
    target: 'redevelop',
    reason: 'the developer failed or could not make `pnpm verify` pass',
  },
  {
    stage: 'develop',
    problems: ['plan_gap'],
    target: 'replan',
    reason: 'the developer found a gap in the plan',
  },
  {
    stage: 'approval',
    problems: ['copilot_request_failed'],
    target: 'human',
    reason:
      'the Copilot review could not be requested (is Copilot code review enabled, and does COPILOT_REVIEW_TOKEN have access?)',
  },
  // For now a human.
  {
    stage: 'ci',
    problems: ['ci_failed'],
    target: 'human',
    reason: 'CI failed on the agent PR, see run',
  },
  // No retry loop (issue #154): a person reads the run and re-runs
  // Pipeline · Review, or takes the PR over.
  {
    stage: 'review',
    problems: ['agent_error', 'invalid_output'],
    target: 'human',
    reason:
      'the Claude review failed or returned invalid output; re-run Pipeline · Review for the PR, see run',
  },
  // The owner said no to the protected changes; the branch is kept and the
  // owner decides what happens to it.
  {
    stage: 'develop',
    problems: ['protected_rejected'],
    target: 'human',
    reason:
      'the owner rejected the protected changes; the branch is kept for the owner to decide',
  },
  // Never retried: someone closed the PR on purpose. A person decides
  // whether to restart the issue or close it.
  {
    stage: 'pr',
    problems: ['pr_closed'],
    target: 'human',
    reason:
      'the pull request was closed without merging; restart the issue or close it',
  },
];

const ruleFor = (stage, problem) =>
  RULES.find((r) => r.stage === stage && r.problems.includes(problem));

/** Legal targets for one (stage, problem). An external brain picks from these. */
export function allowedTargets(stage, problem) {
  if (HARD_GATES.includes(problem)) return ['human'];
  const rule = ruleFor(stage, problem);
  return [...new Set([rule?.target ?? 'human', 'human'])];
}

/** The deterministic brain: one row of the rules table. */
export function decideByRules({ outcome }) {
  if (!outcome || outcome.result !== 'problem')
    return { target: 'human', reason: 'no problem to route', questions: [] };
  const questions = outcome.questions ?? [];
  if (HARD_GATES.includes(outcome.problem))
    return {
      target: 'human',
      reason: `hard gate: ${PROBLEM_TEXT[outcome.problem]}`,
      questions,
    };
  const rule = ruleFor(outcome.stage, outcome.problem);
  if (!rule)
    return {
      target: 'human',
      reason: `no rule for ${outcome.stage}/${outcome.problem}`,
      questions,
    };
  return { target: rule.target, reason: rule.reason, questions };
}

/**
 * The route notes that count against the caps: the routes to replan or
 * redevelop that come AFTER the latest `restart` note (see
 * parseRestartNote; `routes` is oldest first and may hold restart entries,
 * `{ target: 'restart' }`). With no restart on record, every route counts.
 *
 * Only a restart opens a window. A route to a human never does, and a
 * human note is not itself a round, so it is not counted either. Nothing a
 * person does to the labels (removing stage:needs-attention, re-adding a
 * stage) writes a note, so it cannot open one: the item continues with the
 * budget it already used and its next problem goes straight back to a
 * human. Restarts come only from the owner's /restart command
 * (decideRestart), at most MAX_LIFETIME_RESETS per issue.
 */
export function routeWindow(routes = []) {
  const lastRestart = routes.findLastIndex((r) => r.target === 'restart');
  return routes
    .slice(lastRestart + 1)
    .filter((r) => r.target !== 'restart' && r.target !== 'human');
}

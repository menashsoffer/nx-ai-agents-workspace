// outcomes: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).
import { MARKERS } from './constants.mjs';

// ---------------------------------------------------------------- outcomes

/** Stages that leave outcome notes. */
export const OUTCOME_STAGES = [
  // Legacy: spec.yml is gone, but old spec-stage notes must still parse.
  'spec',
  // Spec + plan, one Claude run (plan.yml).
  'plan',
  'develop',
  'approval',
  'ci',
  // The independent Claude review of a pipeline PR's head (review.yml).
  'review',
  // The PR itself: closed without merging (done.yml). Noted on the issue.
  'pr',
];

/** Closed set of problem codes an outcome note may carry. */
export const PROBLEMS = [
  'none', // success
  'invalid_output', // the agent answered, but not in the required shape
  'agent_error', // the agent run failed (API, quota, timeout, no changes)
  'spec_missing', // legacy (read-only): the old plan stage found no spec comment
  'spec_questions', // plan: the issue is unclear; questions block the spec
  'untestable_criteria', // legacy (read-only): the old plan stage found untestable criteria
  'verify_failed', // develop: `pnpm verify` could not be made green
  'plan_gap', // develop: the plan is wrong or incomplete
  'copilot_request_failed', // approval: could not request Copilot
  'ci_failed', // ci: CI failed on a pipeline PR's current head
  'pr_closed', // pr: the issue's PR was closed without merging
  'protected_rejected', // develop: the owner rejected the protected changes
  // Hard gates (HARD_GATES): always a human.
  'protected_surface',
  'needs_secrets_ci_infra',
  'scope_split',
  'embedded_instructions',
  'forbidden_path',
  // The patch needs the owner's approval (a request was posted, no PR yet).
  'protected_approval_needed',
];

/**
 * Problems no automation may route around, whatever the mode, caps or
 * brain: protected files (AGENTS.md "Protected files"), secrets/CI/infra or
 * a backend, instructions embedded in the issue, and patches that
 * check-patch rejected. (`scope_split` is not a gate: it is an ordinary
 * rule that leads to a human, see RULES.)
 */
export const HARD_GATES = [
  'protected_surface',
  'needs_secrets_ci_infra',
  'embedded_instructions',
  'forbidden_path',
  'protected_approval_needed',
];

export const OUTCOME_VERSION = 1;

const MAX_LIST = 20;

/** Single-line, bounded, marker-free text for notes built from agent output. */
export function clean(text, max = 500) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/<!--/g, '&lt;!--')
    .trim()
    .slice(0, max);
}

export const cleanList = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((x) => typeof x === 'string' && x.trim())
    .slice(0, MAX_LIST)
    .map((x) => clean(x));

const runId = (url) => /\/runs\/(\d+)/.exec(url ?? '')?.[1] ?? '-';

/**
 * Coerces a workflow-built outcome into a valid one. Unknown problem codes
 * (e.g. from an agent) become `invalid_output` with a detail line, so a
 * broken note can never block the item.
 */
export function normalizeOutcome(input) {
  const o = input ?? {};
  if (!OUTCOME_STAGES.includes(o.stage))
    throw new Error(`Unknown outcome stage: ${o.stage}`);
  const details = cleanList(o.details);
  const result = o.result === 'success' ? 'success' : 'problem';
  let problem = 'none';
  if (result === 'problem') {
    if (PROBLEMS.includes(o.problem) && o.problem !== 'none')
      problem = o.problem;
    else {
      problem = 'invalid_output';
      details.push(clean(`Unknown problem code "${o.problem ?? ''}".`));
    }
  }
  const item = Number(o.item);
  return {
    v: OUTCOME_VERSION,
    stage: o.stage,
    result,
    problem,
    summary: clean(o.summary, 300) || defaultSummary(o.stage, problem),
    questions: cleanList(o.questions),
    details: details.slice(0, MAX_LIST),
    run_url: clean(o.run_url, 300),
    prompt_version: clean(o.prompt_version, 100),
    item: Number.isInteger(item) && item > 0 ? item : null,
  };
}

const STAGE_TITLE = {
  spec: 'Spec',
  plan: 'Plan',
  develop: 'Development',
  approval: 'Approval',
  ci: 'CI',
  review: 'Review',
  pr: 'Pull request',
};

export const PROBLEM_TEXT = {
  invalid_output: 'the agent output is invalid',
  agent_error: 'the agent run failed',
  spec_missing: 'there is no spec',
  spec_questions: 'the issue is unclear or its criteria are not testable',
  untestable_criteria: 'the acceptance criteria are not testable',
  verify_failed: '`pnpm verify` does not pass',
  plan_gap: 'the plan is wrong or incomplete',
  copilot_request_failed: 'the Copilot review could not be requested',
  ci_failed: 'CI failed on the agent PR',
  pr_closed: 'the pull request was closed without merging',
  protected_rejected: 'the owner rejected the protected changes',
  protected_approval_needed:
    'the change touches protected files and needs owner approval',
  protected_surface: 'the work touches protected files',
  needs_secrets_ci_infra:
    'the work needs secrets, CI, infrastructure or a server',
  scope_split:
    'the work is too big (or over the auto-approval size limits) and should be split',
  embedded_instructions: 'the issue contains instructions aimed at the agents',
  forbidden_path: 'the patch touches protected paths',
};

function defaultSummary(stage, problem) {
  return problem === 'none'
    ? `${STAGE_TITLE[stage]} done.`
    : `${STAGE_TITLE[stage]} stopped: ${PROBLEM_TEXT[problem]}.`;
}

/** Renders an outcome note (a new comment; never upserted). */
export function renderOutcome(input) {
  const o = normalizeOutcome(input);
  const lines = [
    `${MARKERS.outcome} stage=${o.stage} result=${o.result} problem=${o.problem} run=${runId(o.run_url)} -->`,
    `**${o.summary}**`,
  ];
  const bullets = [
    ...o.details.map((d) => `- ${d}`),
    ...o.questions.map((q) => `- Question: ${q}`),
  ];
  if (o.run_url) bullets.push(`- Run: ${o.run_url}`);
  if (bullets.length) lines.push('', ...bullets);
  lines.push('', '```json', JSON.stringify(o), '```');
  return lines.join('\n');
}

export function lastJsonFence(body) {
  const fences = [...String(body).matchAll(/```json\n(.*)\n```/g)];
  if (!fences.length) return { error: 'no json block' };
  try {
    return { value: JSON.parse(fences.at(-1)[1]) };
  } catch {
    return { error: 'json block does not parse' };
  }
}

export const attrs = (header) =>
  Object.fromEntries(
    [...header.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]),
  );

/** Strictly parses an outcome note. `{ ok: false, error }` on anything off. */
export function parseOutcome(body) {
  const text = String(body ?? '');
  const header = /^<!-- pipeline:outcome ([^\n]*?) -->\n/.exec(text);
  if (!header) return { ok: false, error: 'not an outcome note' };
  const { value: o, error } = lastJsonFence(text);
  if (error) return { ok: false, error };
  if (!o || typeof o !== 'object') return { ok: false, error: 'not an object' };
  if (o.v !== OUTCOME_VERSION)
    return { ok: false, error: `unsupported version ${o.v}` };
  if (!OUTCOME_STAGES.includes(o.stage))
    return { ok: false, error: `unknown stage ${o.stage}` };
  if (o.result !== 'success' && o.result !== 'problem')
    return { ok: false, error: `unknown result ${o.result}` };
  if (!PROBLEMS.includes(o.problem))
    return { ok: false, error: `unknown problem ${o.problem}` };
  if ((o.result === 'success') !== (o.problem === 'none'))
    return { ok: false, error: 'result and problem disagree' };
  const a = attrs(header[1]);
  if (a.stage !== o.stage || a.result !== o.result || a.problem !== o.problem)
    return { ok: false, error: 'marker and json disagree' };
  if (typeof o.summary !== 'string')
    return { ok: false, error: 'summary missing' };
  for (const key of ['questions', 'details'])
    if (o[key] !== undefined && !Array.isArray(o[key]))
      return { ok: false, error: `${key} is not a list` };
  return { ok: true, outcome: normalizeOutcome(o) };
}

// plan-approval: split from ../../../../../home/user/nx-ai-agents-workspace/.github/scripts/pipeline-lib.mjs (pure move).
import { classifyProtectedPaths, normalizePath } from './patches.mjs';
import { clean } from './outcomes.mjs';

// ---------------------------------------------------------------- classify
export const parseJson = (raw) => {
  try {
    const v = JSON.parse(String(raw ?? ''));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- plan

// The plan stage is one Claude run that writes two artifacts (a spec and a
// plan). The item moves straight to stage:planned only if every check in
// evaluatePlanApproval passes. Two-week trial: tune these two numbers here.
/** Auto-approval size limits: files the plan touches, and estimated lines. */
export const PLAN_MAX_FILES = 10;

export const PLAN_MAX_LINES = 400;

/**
 * Problems the planner itself may report (its --json-schema enum, which
 * plan.yml must keep in step). `agent_error` and `invalid_output` are never
 * the agent's to report: classifyPlan assigns them.
 */
export const PLAN_AGENT_PROBLEMS = [
  'spec_questions',
  'scope_split',
  'protected_surface',
  'needs_secrets_ci_infra',
  'embedded_instructions',
];

// Order in which failed auto-approval checks are reported: gates first.
const PLAN_PROBLEM_PRIORITY = [
  'embedded_instructions',
  'protected_surface',
  'needs_secrets_ci_infra',
  'invalid_output',
  'spec_questions',
  'scope_split',
];

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

/** Required text fields of the planner's `spec` and `plan` objects. */
const SPEC_TEXT_FIELDS = [
  'goal',
  'rtl_accessibility',
  'out_of_scope',
  'assumptions',
  'test_plan',
];

const PLAN_TEXT_FIELDS = ['approach', 'tests', 'risks', 'definition_of_done'];

/**
 * Structural check of a planned result: both parts present with every
 * required section, every criterion and change well formed. Returns
 * `{ errors, files }`, where `files` is the deduplicated, normalised list of
 * planned paths and `lines` the estimated total (both only meaningful when
 * there are no errors).
 */
function checkPlanShape(r) {
  const errors = [];
  const { spec, plan } = r;
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(spec)) errors.push('`spec` is missing.');
  if (!isObj(plan)) errors.push('`plan` is missing.');
  if (!isObj(r.signals) || typeof r.signals.embedded_instructions !== 'boolean')
    errors.push('`signals` is missing or malformed.');
  else if (typeof r.signals.needs_secrets_ci_infra !== 'boolean')
    errors.push('`signals` is missing or malformed.');
  const files = new Set();
  let lines = 0;
  if (isObj(spec)) {
    for (const f of SPEC_TEXT_FIELDS)
      if (!isText(spec[f])) errors.push(`spec.${f} is empty or missing.`);
    const crit = spec.acceptance_criteria;
    if (!Array.isArray(crit) || crit.length === 0)
      errors.push('spec.acceptance_criteria has no criteria.');
    else
      crit.forEach((c, i) => {
        if (!isObj(c) || !isText(c.text))
          errors.push(`Acceptance criterion ${i + 1} is empty.`);
        else if (typeof c.testable !== 'boolean')
          errors.push(`Acceptance criterion ${i + 1} has no testable flag.`);
      });
  }
  if (isObj(plan)) {
    for (const f of PLAN_TEXT_FIELDS)
      if (!isText(plan[f])) errors.push(`plan.${f} is empty or missing.`);
    if (!Array.isArray(plan.changes) || plan.changes.length === 0)
      errors.push('plan.changes lists no files.');
    else
      plan.changes.forEach((c, i) => {
        const path =
          isObj(c) && isText(c.file) ? normalizePath(c.file.trim()) : null;
        if (path === null)
          errors.push(`Change ${i + 1} has no valid repo-relative file.`);
        else files.add(path);
        if (!isObj(c) || !isText(c.project) || !isText(c.change))
          errors.push(`Change ${i + 1} needs a project and a description.`);
        if (!isObj(c) || !Number.isInteger(c.lines) || c.lines < 0)
          errors.push(
            `Change ${i + 1} needs an estimated line count (integer).`,
          );
        else lines += c.lines;
      });
  }
  return { errors, files: [...files], lines };
}

/**
 * Auto-approval: may this planned result move straight to stage:planned?
 * Pure. All of these must hold:
 * - schema: `spec` and `plan` present with every required section;
 * - every acceptance criterion is non-empty and marked testable;
 * - scope: no planned file is a never-approvable protected path (see
 *   FORBIDDEN_PATH_PATTERNS; approvable ones pass and are reported as
 *   `protectedPaths`, the owner approves them before a PR opens), and the
 *   planner reports no need for secrets, CI or infrastructure;
 * - size: at most `limits.maxFiles` files and `limits.maxLines` estimated
 *   changed lines;
 * - the planner reported no instructions embedded in the issue.
 * Returns `{ approved: true, files, lines, protectedPaths? }` (the last only
 * when the plan touches approvable protected paths), or `{ approved: false,
 * problem, details, questions }` (`problem` is the highest-priority failure
 * in PLAN_PROBLEM_PRIORITY; `details` lists every failure).
 */
export function evaluatePlanApproval(
  result,
  { maxFiles = PLAN_MAX_FILES, maxLines = PLAN_MAX_LINES } = {},
) {
  const r = result && typeof result === 'object' ? result : {};
  const failures = [];
  const fail = (problem, detail) => failures.push({ problem, detail });
  if (r.signals?.embedded_instructions === true)
    fail(
      'embedded_instructions',
      'The planner reported instructions aimed at the agents in the issue.',
    );
  const shape = checkPlanShape(r);
  for (const e of shape.errors) fail('invalid_output', e);
  if (r.signals?.needs_secrets_ci_infra === true)
    fail(
      'needs_secrets_ci_infra',
      'The planner reported that the work needs secrets, CI, infrastructure or a server.',
    );
  const cls = classifyProtectedPaths(shape.files, { foldCase: true });
  if (cls.never.length)
    fail(
      'protected_surface',
      `The plan touches protected paths that only a local session may change: ${cls.never.join(', ')}.`,
    );
  if (!shape.errors.length) {
    (r.spec.acceptance_criteria ?? []).forEach((c, i) => {
      if (!c.testable)
        fail(
          'spec_questions',
          `Acceptance criterion ${i + 1} is not testable: ${clean(c.text, 200)}`,
        );
    });
    if (shape.files.length > maxFiles)
      fail(
        'scope_split',
        `The plan touches ${shape.files.length} files (limit ${maxFiles}).`,
      );
    if (shape.lines > maxLines)
      fail(
        'scope_split',
        `The plan is estimated at ${shape.lines} changed lines (limit ${maxLines}).`,
      );
  }
  if (!failures.length)
    return {
      approved: true,
      files: shape.files,
      lines: shape.lines,
      ...(cls.approvable.length ? { protectedPaths: cls.approvable } : {}),
    };
  const problem = PLAN_PROBLEM_PRIORITY.find((p) =>
    failures.some((f) => f.problem === p),
  );
  return {
    approved: false,
    problem,
    details: failures.map((f) => f.detail),
    questions: failures
      .filter((f) => f.problem === 'spec_questions')
      .map((f) => f.detail),
  };
}

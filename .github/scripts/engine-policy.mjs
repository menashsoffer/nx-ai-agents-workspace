// Engine policy: which paths an agent's change may touch in a target.
//
// The engine fixes a minimum set of protected paths (workflows and the
// profile under .github/, CODEOWNERS, agent configuration, ...). A target's
// profile can only ADD protected paths and, optionally, narrow every change
// to a writable allowlist; it has no way to remove or negate one of the
// engine's. Used for planned files (plan stage) and for patches (develop
// check and publish). Pure: no I/O.
import { classifyPlan, patchPaths } from './pipeline-lib.mjs';

/**
 * Protected in every target, whatever its profile says. Patterns are
 * anchored at the repository root; `**` spans directories.
 */
export const ENGINE_PROTECTED_PATHS = Object.freeze([
  '.github/**',
  '**/CODEOWNERS',
  '.claude/**',
  '.codex/**',
  '.pipeline/**',
  '**/.npmrc',
  '.gitmodules',
]);

/** One segment: letters, digits, `._-` and `*`; or `**` alone. */
const SEGMENT = /^(?:\*\*|[A-Za-z0-9._*-]+)$/;

/** True for a repository path pattern the policy understands. */
export function isPathPattern(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 200)
    return false;
  const segments = pattern.split('/');
  return segments.every(
    (segment) => SEGMENT.test(segment) && segment !== '.' && segment !== '..',
  );
}

const escapeRegex = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Pattern -> RegExp. `ignoreCase` for protected paths (case-insensitive disks). */
function patternToRegex(pattern, { ignoreCase }) {
  const body = pattern
    .split('/')
    .map((segment, index, all) => {
      if (segment === '**')
        return index === all.length - 1 ? '.*' : '(?:[^/]+/)*';
      const part = escapeRegex(segment).replace(/\*/g, '[^/]*');
      return index === all.length - 1 ? part : `${part}/`;
    })
    .join('');
  return new RegExp(`^${body}$`, ignoreCase ? 'i' : '');
}

/** The policy for one target: the engine minimum plus the profile's additions. */
export function buildPolicy(profile) {
  const added = profile?.paths?.protected ?? [];
  const writable = profile?.paths?.writable ?? null;
  const protectedPatterns = [...new Set([...ENGINE_PROTECTED_PATHS, ...added])];
  return {
    protectedPatterns,
    writablePatterns: writable,
    limits: profile.limits,
    protectedRegexes: protectedPatterns.map((pattern) =>
      patternToRegex(pattern, { ignoreCase: true }),
    ),
    writableRegexes: writable?.map((pattern) =>
      patternToRegex(pattern, { ignoreCase: false }),
    ),
  };
}

/**
 * Splits changed or planned paths into `protected` (match a protected
 * pattern) and `outsideWritable` (the profile has an allowlist and the path
 * is not on it). `ok` only when both are empty.
 */
export function checkPaths(paths, policy) {
  const isProtected = (path) =>
    policy.protectedRegexes.some((regex) => regex.test(path));
  const isWritable = (path) =>
    !policy.writableRegexes ||
    policy.writableRegexes.some((regex) => regex.test(path));
  const sorted = [...new Set(paths)].sort();
  const protectedPaths = sorted.filter(isProtected);
  const outsideWritable = sorted.filter(
    (path) => !isProtected(path) && !isWritable(path),
  );
  return {
    ok: !protectedPaths.length && !outsideWritable.length,
    protected: protectedPaths,
    outsideWritable,
  };
}

/** Lines a patch adds or removes (its hunk bodies, not its headers). */
export function changedLineCount(patch) {
  let count = 0;
  let inHunk = false;
  for (const line of String(patch).split('\n')) {
    if (line.startsWith('diff --git')) inHunk = false;
    else if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && /^[+-]/.test(line)) count += 1;
  }
  return count;
}

/**
 * The develop patch against the policy: no unparseable header (fail
 * closed), no protected path, nothing outside the writable allowlist, and
 * within the profile's file and line limits. Returns `{ ok, problems,
 * paths }`.
 */
export function checkPatchPolicy(patch, policy) {
  const { paths, errors } = patchPaths(patch);
  const result = checkPaths(paths, policy);
  const problems = [
    ...errors,
    ...result.protected.map((path) => `protected: ${path}`),
    ...result.outsideWritable.map(
      (path) => `outside the writable paths: ${path}`,
    ),
  ];
  if (!paths.length) problems.push('the patch changes no file');
  if (paths.length > policy.limits.maxFiles)
    problems.push(
      `the patch changes ${paths.length} files (limit ${policy.limits.maxFiles})`,
    );
  const lines = changedLineCount(patch);
  if (lines > policy.limits.maxLines)
    problems.push(
      `the patch changes ${lines} lines (limit ${policy.limits.maxLines})`,
    );
  return { ok: problems.length === 0, problems, paths };
}

/** Repo-relative files of a planned result, or [] when there are none. */
function plannedFiles(raw) {
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    return [];
  }
  const changes = result?.status === 'planned' ? result.plan?.changes : null;
  if (!Array.isArray(changes)) return [];
  return changes
    .filter((change) => typeof change?.file === 'string')
    .map((change) =>
      change.file
        .trim()
        .replace(/^(?:\.\/)+/, '')
        .replace(/\/{2,}/g, '/'),
    );
}

/**
 * Plan outcome for a target: classifyPlan (schema, testable criteria,
 * signals, the profile's size limits) and the planned files against the
 * policy. A planned protected or non-writable path is `protected_surface`
 * (a person decides); it outranks every other problem except
 * `embedded_instructions`. Returns an outcome input for normalizeOutcome.
 */
export function classifyEnginePlan({ jobResult, raw, policy }) {
  const outcome = classifyPlan({ jobResult, raw, limits: policy.limits });
  const files = plannedFiles(raw);
  const paths = checkPaths(files, policy);
  if (!paths.ok && outcome.problem !== 'embedded_instructions')
    return {
      stage: 'plan',
      result: 'problem',
      problem: 'protected_surface',
      details: [
        ...paths.protected.map(
          (path) => `The plan touches a protected path: ${path}.`,
        ),
        ...paths.outsideWritable.map(
          (path) =>
            `The plan touches a path outside the profile's writable paths: ${path}.`,
        ),
      ],
    };
  if (outcome.result !== 'success') return outcome;
  const lines = JSON.parse(raw).plan.changes.reduce(
    (sum, change) => sum + change.lines,
    0,
  );
  return {
    stage: 'plan',
    result: 'success',
    summary: `Spec and plan posted and auto-approved (${new Set(files).size} file(s), ~${lines} lines).`,
  };
}

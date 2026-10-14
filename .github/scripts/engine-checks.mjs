// Built-in deterministic checks the engine runs on a target after the
// develop patch is applied. They are engine code at the pinned commit, so
// they never execute target code.
// - Always: `regular-files` (every changed path is a plain file or deleted;
//   no symbolic link, also not through a parent folder) and `file-length`
//   (no changed file over ENGINE_LIMITS.maxFileLines lines).
// - Chosen by the profile (CHECK_NAMES in engine-profile.mjs).
//
// No check passes on an empty set: a check that finds nothing to look at
// fails ("nothing to check") instead of reporting success.
//
// Pure: file access goes through the `inspect` callback, which returns
// `{ kind: 'missing' }`, `{ kind: 'file', content }` (a Buffer), or
// `{ kind: 'symlink' | 'other' }`.
import { ENGINE_LIMITS, buildPolicy, checkPaths } from './engine-policy.mjs';

const MAX_MARKDOWN_BYTES = 200_000;
/** Raw HTML that renders or runs something in a Markdown viewer. */
const ACTIVE_HTML =
  /<\s*(script|iframe|object|embed|form|style)\b|\bon[a-z]+\s*=|javascript:/i;

const result = (name, problems, checkedCount) => ({
  name,
  isPassing: problems.length === 0,
  checkedCount,
  problems,
});

const nothingToCheck = (name) => result(name, ['nothing to check'], 0);

/** Physical lines of a text, as an editor counts them. */
const lineCount = (text) =>
  text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

/** Each changed path is a regular file, or gone (deleted by the patch). */
function checkRegularFiles({ changedPaths, inspect }) {
  if (!changedPaths.length) return nothingToCheck('regular-files');
  const problems = [];
  for (const path of changedPaths) {
    const { kind } = inspect(path);
    if (kind === 'symlink') problems.push(`symbolic link: ${path}`);
    else if (kind !== 'file' && kind !== 'missing')
      problems.push(`not a regular file: ${path}`);
  }
  return result('regular-files', problems, changedPaths.length);
}

/** No changed file is longer than the engine's per-file cap. */
function checkFileLength({ changedPaths, inspect }) {
  if (!changedPaths.length) return nothingToCheck('file-length');
  const problems = [];
  for (const path of changedPaths) {
    const file = inspect(path);
    if (file.kind !== 'file') continue;
    const lines = lineCount(file.content.toString('utf8'));
    if (lines > ENGINE_LIMITS.maxFileLines)
      problems.push(
        `${path} has ${lines} lines (cap ${ENGINE_LIMITS.maxFileLines})`,
      );
  }
  return result('file-length', problems, changedPaths.length);
}

/** The patch must change at least one file. */
function checkPatchNotEmpty({ changedPaths }) {
  if (!changedPaths.length) return nothingToCheck('patch-not-empty');
  return result('patch-not-empty', [], changedPaths.length);
}

/** Every changed path is on the profile's writable list and not protected. */
function checkWritablePaths({ changedPaths, profile }) {
  if (!changedPaths.length) return nothingToCheck('writable-paths');
  if (!profile.paths.writable)
    return result('writable-paths', ['the profile lists no writable paths'], 0);
  const paths = checkPaths(changedPaths, buildPolicy(profile));
  return result(
    'writable-paths',
    [
      ...paths.protected.map((path) => `protected: ${path}`),
      ...paths.outsideWritable.map((path) => `not writable: ${path}`),
    ],
    changedPaths.length,
  );
}

/**
 * Every changed file that still exists is a Markdown file: UTF-8 text,
 * not empty, at most 200 kB, with no active HTML. Fails when no Markdown
 * file was changed.
 */
function checkMarkdownFiles({ changedPaths, inspect }) {
  const problems = [];
  let checkedCount = 0;
  for (const path of changedPaths) {
    const file = inspect(path);
    if (file.kind === 'missing') continue;
    if (file.kind !== 'file' || !/\.md$/i.test(path)) {
      problems.push(`not a Markdown file: ${path}`);
      continue;
    }
    checkedCount += 1;
    const text = file.content.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(file.content))
      problems.push(`not valid UTF-8: ${path}`);
    if (!text.trim()) problems.push(`empty: ${path}`);
    if (file.content.length > MAX_MARKDOWN_BYTES)
      problems.push(`larger than ${MAX_MARKDOWN_BYTES} bytes: ${path}`);
    if (ACTIVE_HTML.test(text)) problems.push(`active HTML: ${path}`);
  }
  if (!checkedCount && !problems.length)
    return nothingToCheck('markdown-files');
  if (!checkedCount) problems.push('no Markdown file was checked');
  return result('markdown-files', problems, checkedCount);
}

/**
 * The task's exact result: every file the issue's `expected <path>` blocks
 * name (engine-expectations.mjs) has exactly that content after the patch,
 * and the patch changes no other file. Fails when the task names none.
 */
function checkExactContent({ changedPaths, inspect, expectations }) {
  if (!expectations.length)
    return result('exact-content', ['the task states no expected content'], 0);
  const problems = [];
  const expectedPaths = expectations.map((expectation) => expectation.path);
  for (const path of changedPaths)
    if (!expectedPaths.includes(path))
      problems.push(`changed but not expected: ${path}`);
  for (const { path, content } of expectations) {
    const file = inspect(path);
    if (!changedPaths.includes(path))
      problems.push(`expected but not changed: ${path}`);
    else if (file.kind !== 'file') problems.push(`not a regular file: ${path}`);
    else if (file.content.toString('utf8') !== content)
      problems.push(`content differs from the expected content: ${path}`);
  }
  return result('exact-content', problems, expectations.length);
}

const MANDATORY_CHECKS = {
  'regular-files': checkRegularFiles,
  'file-length': checkFileLength,
};

const PROFILE_CHECKS = {
  'patch-not-empty': checkPatchNotEmpty,
  'writable-paths': checkWritablePaths,
  'markdown-files': checkMarkdownFiles,
  'exact-content': checkExactContent,
};

/**
 * Runs the mandatory checks, then the profile's. `changedPaths` come from
 * the patch; `expectations` from the task (only `exact-content` reads them).
 * Returns one result per check.
 */
export function runChecks({
  profile,
  changedPaths,
  inspect,
  expectations = [],
}) {
  const input = { profile, changedPaths, inspect, expectations };
  return [
    ...Object.values(MANDATORY_CHECKS).map((check) => check(input)),
    ...profile.checks.map((name) =>
      Object.hasOwn(PROFILE_CHECKS, name)
        ? PROFILE_CHECKS[name](input)
        : result(name, [`unknown check ${name}`], 0),
    ),
  ];
}

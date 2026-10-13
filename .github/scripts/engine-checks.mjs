// Built-in deterministic checks the engine runs on a target after the
// develop patch is applied (profile `checks`, engine-profile.mjs). They are
// engine code at the pinned commit, so they never execute target code.
//
// No check passes on an empty set: a check that finds nothing to look at
// fails ("nothing to check") instead of reporting success.
//
// Pure: file access goes through the `readFile` callback.
import { buildPolicy, checkPaths } from './engine-policy.mjs';

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
function checkMarkdownFiles({ changedPaths, readFile }) {
  const problems = [];
  let checkedCount = 0;
  for (const path of changedPaths) {
    const content = readFile(path);
    if (content === null) continue; // deleted by the patch
    if (!/\.md$/i.test(path)) {
      problems.push(`not a Markdown file: ${path}`);
      continue;
    }
    checkedCount += 1;
    const text = content.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(content))
      problems.push(`not valid UTF-8: ${path}`);
    if (!text.trim()) problems.push(`empty: ${path}`);
    if (content.length > MAX_MARKDOWN_BYTES)
      problems.push(`larger than ${MAX_MARKDOWN_BYTES} bytes: ${path}`);
    if (ACTIVE_HTML.test(text)) problems.push(`active HTML: ${path}`);
  }
  if (!checkedCount && !problems.length)
    return nothingToCheck('markdown-files');
  if (!checkedCount) problems.push('no Markdown file was checked');
  return result('markdown-files', problems, checkedCount);
}

const CHECKS = {
  'patch-not-empty': checkPatchNotEmpty,
  'writable-paths': checkWritablePaths,
  'markdown-files': checkMarkdownFiles,
};

/**
 * Runs the profile's checks. `changedPaths` come from the patch;
 * `readFile(path)` returns a Buffer, or null for a file that does not exist.
 * Returns one result per check; an empty check list is itself a failure.
 */
export function runChecks({ profile, changedPaths, readFile }) {
  if (!profile.checks.length)
    return [result('checks', ['the profile lists no checks'], 0)];
  return profile.checks.map((name) =>
    Object.hasOwn(CHECKS, name)
      ? CHECKS[name]({ profile, changedPaths, readFile })
      : result(name, [`unknown check ${name}`], 0),
  );
}

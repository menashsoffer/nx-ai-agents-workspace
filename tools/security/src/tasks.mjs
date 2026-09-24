// A7 (docs/security.md): every task an agent can trigger through a
// pre-approved command (`pnpm verify`, `pnpm nx run-many`, `pnpm nx test`, ...)
// must be defined by reviewed config. Package scripts, `nx:run-commands` /
// `nx:run-script` targets, targets with unlisted executors and Nx plugins are
// compared against tools/security/tasks.json (protected, reviewed); anything
// new or changed fails.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/** Never project sources; everything else is scanned, gitignored or not. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.nx']);
const PROJECT_FILES = new Set(['package.json', 'project.json']);
const SHELL_EXECUTORS = ['nx:run-commands', 'nx:run-script'];

/** Relative (posix) paths of every package.json / project.json under root. */
export function findProjectFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Symlinks are not followed (no loops, and Nx doesn't follow them).
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        walk(join(dir, entry.name));
      } else if (entry.isFile() && PROJECT_FILES.has(entry.name)) {
        found.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return found.sort();
}

/** The executor Nx would run for an explicit target definition. */
function executorOf(target) {
  if (target?.executor) return target.executor;
  if (target?.command || target?.options?.command || target?.options?.commands)
    return 'nx:run-commands';
  return undefined; // only overrides options of an inferred target
}

/**
 * @param {{ scripts: Record<string,string>, targets: Record<string,unknown>,
 *   executors: string[], nxPlugins: string[] }} allowlist
 * @param {{ path: string, json: any }[]} files package.json / project.json
 * @param {any} nxJson
 * @returns {string[]} problems
 */
export function checkTasks(allowlist, files, nxJson) {
  const problems = [];
  const reviewed = (key, value, kind) => {
    if (!(key in allowlist[kind])) {
      problems.push(`A7: ${key} is not in tools/security/tasks.json.`);
    } else if (!isDeepStrictEqual(allowlist[kind][key], value)) {
      problems.push(
        `A7: ${key} differs from the reviewed entry in tools/security/tasks.json.`,
      );
    }
  };
  const checkTarget = (key, target) => {
    const executor = executorOf(target);
    if (executor === undefined) return;
    if (
      SHELL_EXECUTORS.includes(executor) ||
      !allowlist.executors.includes(executor)
    ) {
      reviewed(key, target, 'targets');
    }
  };

  for (const { path, json } of files) {
    if (path.endsWith('package.json')) {
      // Root scripts run through `pnpm <script>`; project scripts become
      // `nx:run-script` targets. Both are pinned.
      for (const [name, command] of Object.entries(json?.scripts ?? {})) {
        reviewed(`${path}#${name}`, command, 'scripts');
      }
    }
    const targets = path.endsWith('project.json')
      ? json?.targets
      : json?.nx?.targets;
    for (const [name, target] of Object.entries(targets ?? {})) {
      checkTarget(`${path}#${name}`, target);
    }
  }

  for (const [name, target] of Object.entries(nxJson?.targetDefaults ?? {})) {
    checkTarget(`nx.json#targetDefaults.${name}`, target);
  }
  for (const plugin of nxJson?.plugins ?? []) {
    const name = typeof plugin === 'string' ? plugin : plugin?.plugin;
    if (!allowlist.nxPlugins.includes(name)) {
      problems.push(
        `A7: Nx plugin "${name}" in nx.json is not in tools/security/tasks.json (plugins define targets and run on every nx command).`,
      );
    }
  }
  return problems;
}

/** Runs A7 against the repository. */
export function checkRepoTasks(root, allowlistPath) {
  const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const files = findProjectFiles(root).map((path) => ({
    path,
    json: readJson(join(root, path)),
  }));
  const nxJsonPath = join(root, 'nx.json');
  return checkTasks(
    readJson(allowlistPath),
    files,
    existsSync(nxJsonPath) ? readJson(nxJsonPath) : {},
  );
}

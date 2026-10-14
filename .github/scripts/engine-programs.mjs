// Executables for the verify orchestrator (engine-verify-commands.mjs),
// resolved to absolute paths BEFORE any target code runs, and accepted
// only where target code cannot replace them: the file and every folder
// above it must be owned by root and not writable by group or others, and
// the orchestrator must not run as root (the workflow removes sudo first).
// Nothing is looked up through PATH after that.
//
// Pure apart from realFileSystem: tests pass their own file system.
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

const PROGRAM_NAME = /^[a-z][a-z0-9._-]{0,40}$/;

/** The file system calls the checks need, from node:fs. */
export const realFileSystem = {
  realpath: (path) => realpathSync(path),
  stat: (path) => statSync(path),
  isExecutable(path) {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
};

/**
 * The real absolute path of `name`, found the way a shell would in
 * `searchPath` (only absolute entries count), or null.
 */
export function resolveProgram(name, searchPath, fileSystem) {
  if (!PROGRAM_NAME.test(String(name))) return null;
  for (const folder of String(searchPath ?? '').split(':')) {
    if (!isAbsolute(folder)) continue;
    const candidate = join(folder, name);
    if (fileSystem.isExecutable(candidate))
      return fileSystem.realpath(candidate);
  }
  return null;
}

/**
 * Why `path` could be replaced by a process that is not root: the file or
 * a folder above it is not root-owned, or is writable by group or others.
 */
export function protectionProblems(path, fileSystem) {
  const problems = [];
  let current = path;
  for (;;) {
    const status = fileSystem.stat(current);
    if (current === path && !status.isFile())
      problems.push(`${current} is not a regular file`);
    if (status.uid !== 0) problems.push(`${current} is not owned by root`);
    if (status.mode & 0o022)
      problems.push(`${current} is writable by group or others`);
    if (current === dirname(current)) break;
    current = dirname(current);
  }
  return problems;
}

/**
 * Resolves and checks every program. Returns `{ paths, folders, problems
 * }`: `paths` maps each name to its absolute path, `folders` is the PATH the
 * commands get (the programs' own protected folders only).
 */
export function resolvePrograms(names, { searchPath, fileSystem, userId }) {
  const problems = [];
  if (userId === 0)
    problems.push(
      'the orchestrator runs as root, so target code could replace anything',
    );
  const paths = {};
  for (const name of [...new Set(names)]) {
    const path = resolveProgram(name, searchPath, fileSystem);
    if (!path) {
      problems.push(`${name} is not on PATH as an executable file`);
      continue;
    }
    paths[name] = path;
    problems.push(
      ...protectionProblems(path, fileSystem).map(
        (problem) => `${name}: ${problem}`,
      ),
    );
  }
  const folders = [
    ...new Set(Object.values(paths).map((path) => dirname(path))),
  ];
  return { paths, folders, problems: [...new Set(problems)] };
}

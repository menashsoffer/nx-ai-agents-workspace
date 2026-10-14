// The trusted orchestrator for a target's setup and verify commands
// (engine-check.yml, verify job). One Node process, started before any
// target code, reads the profile once, resolves every program (and node)
// to an absolute path that target code cannot replace (engine-programs.mjs),
// then runs every setup and verify command as a child by that path and
// decides from their exit codes alone. Nothing is looked up through PATH
// after setup ran, and the children's PATH holds only those protected
// folders. A setup command that rewrites the engine, the profile or a
// program shim on disk cannot turn a failing verify command into a pass.
// The workflow copies the engine and the profile to a root-owned folder,
// makes the toolchain root-owned and removes sudo and Docker access before
// this step; the orchestrator checks its own files, the profile and every
// program (each with every folder above it) and refuses to run otherwise
// (fail closed).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlags } from './pipeline-lib.mjs';
import { failOn, readJson } from './engine-cli-support.mjs';
import {
  inputProblems,
  realFileSystem,
  resolvePrograms,
} from './engine-programs.mjs';

/** The engine's own script files: what this process runs from. */
const SCRIPTS_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const engineFiles = () =>
  readdirSync(SCRIPTS_DIRECTORY)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(SCRIPTS_DIRECTORY, name));

/** `corepack enable` is done by the workflow before the lock, not here. */
const isPrepared = ([program, first]) =>
  program === 'corepack' && first === 'enable';

/**
 * The steps to run: `{ kind, path, args, text }` per command, with every
 * program resolved by `resolve` (resolvePrograms) once, before any of them
 * runs. Returns `{ steps, environment, problems }`.
 */
export function planVerification({ commands, resolve, environment }) {
  const { setup, verify } = commands;
  const problems = [];
  if (!verify.length) problems.push('the profile has no verify commands');
  const listed = [
    ...setup.map((command) => ['setup', command]),
    ...verify.map((command) => ['verify', command]),
  ].filter(([, command]) => !isPrepared(command));
  const resolved = resolve(['node', ...listed.map(([, [program]]) => program)]);
  problems.push(...resolved.problems);
  const steps = listed.map(([kind, [program, ...args]]) => ({
    kind,
    path: resolved.paths[program],
    args,
    text: [program, ...args].join(' '),
  }));
  return {
    steps,
    environment: { ...environment, PATH: resolved.folders.join(':') },
    problems,
  };
}

/** Runs the planned steps in order; the problems of the first failing one. */
export function runVerification({ steps, environment, spawn }) {
  for (const { kind, path, args, text } of steps) {
    console.log(`$ (${kind}) ${text}`);
    const result = spawn(path, args, { stdio: 'inherit', env: environment });
    if (result.status !== 0)
      return [
        `${kind} command failed (${result.status ?? result.signal}): ${text}`,
      ];
  }
  return [];
}

export const verifyCommands = {
  // Runs the profile's setup, then verify commands, in the target (cwd).
  // Exit 1 before running anything when the engine's own files, the profile
  // or a program is not protected, and on the first failing command.
  'verify-target'(args) {
    const flags = parseFlags(args);
    const { commands } = readJson(flags.profile);
    const environment = { HOME: process.env.HOME, CI: 'true' };
    if (process.env.COREPACK_HOME) {
      environment.COREPACK_HOME = process.env.COREPACK_HOME;
      environment.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
    }
    const plan = planVerification({
      commands,
      environment,
      resolve: (names) =>
        resolvePrograms(names, {
          searchPath: process.env.PATH,
          fileSystem: realFileSystem,
          userId: process.getuid?.(),
        }),
    });
    // Every reason to refuse, reported together, before anything runs.
    failOn(
      [
        ...inputProblems(engineFiles(), realFileSystem, 'engine'),
        ...inputProblems(
          [resolvePath(flags.profile)],
          realFileSystem,
          'profile',
        ),
        ...plan.problems,
      ],
      'Verify',
    );
    failOn(runVerification({ ...plan, spawn: spawnSync }), 'Verify');
    console.log(`verify: ${plan.steps.length} command(s) passed`);
  },
};

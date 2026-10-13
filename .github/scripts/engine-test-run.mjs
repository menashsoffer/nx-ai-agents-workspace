// Shared by the engine.mjs CLI tests: a temporary run directory with an
// event payload, a GITHUB_OUTPUT file and a runner for engine.mjs, plus a
// small git target to apply patches to.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProfile } from './engine-profile.mjs';

const ENGINE = fileURLToPath(new URL('./engine.mjs', import.meta.url));

/** A one-line change of `path` in git's patch format. */
export const diffOf = (path, added = 1) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,${added} @@\n-a\n${'+b\n'.repeat(added)}`;

/** Writes a validated profile (with `paths`) to <directory>/profile.json. */
export function writeProfile(directory, paths, extra = {}) {
  const { profile, problems } = validateProfile({
    schema: 1,
    name: 'target',
    summary: 'A target.',
    commands: { verify: [['node', 'scripts/check.mjs']] },
    paths,
    ...extra,
  });
  if (problems.length) throw new Error(problems.join('; '));
  const path = join(directory, 'profile.json');
  writeFileSync(path, JSON.stringify(profile));
  return path;
}

/** A temporary run: event file, output file, and a runner for engine.mjs. */
export function runFor({
  repository,
  repositoryId,
  issue = 7,
  label = 'stage:planned',
}) {
  const directory = mkdtempSync(join(tmpdir(), 'engine-cli-'));
  const eventPath = join(directory, 'event.json');
  const outputPath = join(directory, 'output.txt');
  writeFileSync(
    eventPath,
    JSON.stringify({
      action: 'labeled',
      label: { name: label },
      repository: {
        full_name: repository,
        id: repositoryId,
        default_branch: 'main',
      },
      issue: { number: issue, state: 'open', title: 'probe', body: '' },
    }),
  );
  writeFileSync(outputPath, '');
  const run = (args, { cwd, environment = {} } = {}) =>
    spawnSync(process.execPath, [ENGINE, ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GITHUB_REPOSITORY: repository,
        GITHUB_REPOSITORY_ID: String(repositoryId),
        GITHUB_EVENT_NAME: 'issues',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_TOKEN: 'must-not-leak',
        ...environment,
      },
    });
  return {
    directory,
    run: (...args) => run(args),
    runIn: (cwd, ...args) => run(args, { cwd }),
    runWith: (options, ...args) => run(args, options),
    output: () => readFileSync(outputPath, 'utf8'),
    /** The last value written for `name` to GITHUB_OUTPUT. */
    outputValue: (name) =>
      [
        ...readFileSync(outputPath, 'utf8').matchAll(
          new RegExp(`^${name}<<(\\S+)\\n([\\s\\S]*?)\\n\\1$`, 'gm'),
        ),
      ].at(-1)?.[2],
  };
}

const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args],
    {
      cwd,
      encoding: 'utf8',
    },
  ).trim();

/**
 * A git target in `directory`/target with two commits on main (`oldBase`,
 * then `base`) and a patch (format-patch) that changes SANDBOX_PROBE.md on
 * top of `base`. `git` runs git with a fixed identity in any directory.
 */
export function gitTarget(directory) {
  const target = join(directory, 'target');
  mkdirSync(target);
  git(target, 'init', '-q', '-b', 'main');
  writeFileSync(join(target, 'SANDBOX_PROBE.md'), '# Probe\n');
  git(target, 'add', '-A');
  git(target, 'commit', '-q', '-m', 'old base');
  const oldBase = git(target, 'rev-parse', 'HEAD');
  writeFileSync(join(target, 'README.md'), '# Sandbox\n');
  git(target, 'add', '-A');
  git(target, 'commit', '-q', '-m', 'base');
  const base = git(target, 'rev-parse', 'HEAD');
  git(target, 'switch', '-q', '-c', 'agent');
  writeFileSync(join(target, 'SANDBOX_PROBE.md'), '# Probe\n\nHello.\n');
  git(target, 'commit', '-q', '-am', 'Write the probe');
  const patch = join(directory, 'changes.patch');
  writeFileSync(
    patch,
    git(target, 'format-patch', `${base}..HEAD`, '--stdout') + '\n',
  );
  git(target, 'switch', '-q', 'main');
  git(target, 'branch', '-q', '-D', 'agent');
  return {
    target,
    base,
    oldBase,
    patch,
    git: (cwd, ...args) => git(cwd, ...args),
  };
}

// Shared by the engine.mjs CLI tests: a temporary run directory with an
// event payload, a GITHUB_OUTPUT file and a runner for engine.mjs.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
      repository: { full_name: repository, id: repositoryId },
      issue: { number: issue, state: 'open', title: 'x', body: '' },
    }),
  );
  writeFileSync(outputPath, '');
  const run = (args, { cwd } = {}) =>
    spawnSync(process.execPath, [ENGINE, ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_REPOSITORY: repository,
        GITHUB_REPOSITORY_ID: String(repositoryId),
        GITHUB_EVENT_NAME: 'issues',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_TOKEN: 'must-not-leak',
      },
    });
  return {
    directory,
    run: (...args) => run(args),
    runIn: (cwd, ...args) => run(args, { cwd }),
    output: () => readFileSync(outputPath, 'utf8'),
  };
}

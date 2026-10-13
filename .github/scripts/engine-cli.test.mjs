// Run: pnpm test:pipeline
// engine.mjs end to end, without network: the commands the workflows call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = fileURLToPath(new URL('./engine.mjs', import.meta.url));
const ENGINE_COMMIT = 'a'.repeat(40);
const BASE_COMMIT = 'b'.repeat(40);

/** A temporary run: event file, output file, and a runner for engine.mjs. */
function runFor({
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
  const run = (...args) =>
    spawnSync(process.execPath, [ENGINE, ...args], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_REPOSITORY: repository,
        GITHUB_REPOSITORY_ID: String(repositoryId),
        GITHUB_EVENT_NAME: 'issues',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
      },
    });
  return { directory, run, output: () => readFileSync(outputPath, 'utf8') };
}

const sandboxRun = () =>
  runFor({ repository: 'menashsoffer/pipeline-sandbox', repositoryId: 101 });

test('manifest + check-manifest: same target passes', () => {
  const { directory, run, output } = sandboxRun();
  const manifest = join(directory, 'manifest.json');
  const built = run(
    'manifest',
    '--stage',
    'develop',
    '--base',
    BASE_COMMIT,
    '--branch',
    'issue-7-probe',
    '--engine-commit',
    ENGINE_COMMIT,
    '--out',
    manifest,
  );
  assert.equal(built.status, 0, built.stdout);
  const checked = run(
    'check-manifest',
    '--stage',
    'publish',
    '--engine-commit',
    ENGINE_COMMIT,
    manifest,
  );
  assert.equal(checked.status, 0, checked.stdout);
  assert.match(output(), new RegExp(`base<<.*\\n${BASE_COMMIT}\\n`));
});

test('check-manifest: the same issue number in another repository is refused', () => {
  const sandbox = sandboxRun();
  const manifest = join(sandbox.directory, 'manifest.json');
  sandbox.run(
    'manifest',
    '--stage',
    'develop',
    '--base',
    BASE_COMMIT,
    '--branch',
    'issue-7-probe',
    '--engine-commit',
    ENGINE_COMMIT,
    '--out',
    manifest,
  );
  const workspace = runFor({
    repository: 'menashsoffer/nx-ai-agents-workspace',
    repositoryId: 202,
  });
  const checked = workspace.run(
    'check-manifest',
    '--stage',
    'publish',
    '--engine-commit',
    ENGINE_COMMIT,
    manifest,
  );
  assert.equal(checked.status, 1);
  assert.match(checked.stdout, /the manifest names another repository/);
});

test('a wrong identity fails before anything runs', () => {
  const { run } = runFor({
    repository: 'menashsoffer/pipeline-sandbox',
    repositoryId: 101,
    label: 'stage:qualified',
  });
  const result = run(
    'manifest',
    '--stage',
    'develop',
    '--base',
    BASE_COMMIT,
    '--branch',
    'issue-7-x',
    '--engine-commit',
    ENGINE_COMMIT,
    '--out',
    '/dev/null',
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /Target identity rejected: the label is not stage:planned/,
  );
});

test('check-request: clean request, then a secret in the request', () => {
  const { directory, run, output } = sandboxRun();
  const request = join(directory, 'issue.json');
  writeFileSync(
    request,
    JSON.stringify({ title: 'Probe', body: 'one line', comments: [] }),
  );
  assert.equal(run('check-request', '--stage', 'plan', request).status, 0);
  assert.match(output(), /is_clean<<.*\ntrue\n/);
  const token = `ghp_${'Z'.repeat(36)}`;
  writeFileSync(
    request,
    JSON.stringify({ title: 'Probe', body: token, comments: [] }),
  );
  const stopped = run('check-request', '--stage', 'plan', request);
  assert.equal(stopped.status, 0);
  assert.match(output(), /is_clean<<.*\nfalse\n/);
  assert.match(output(), /needs_secrets_ci_infra/);
  assert.ok(!output().includes(token) && !stopped.stdout.includes(token));
});

test('check-patch: a workflow change is rejected, an ordinary file passes', () => {
  const { directory, run, output } = sandboxRun();
  const patch = join(directory, 'changes.patch');
  const diffOf = (path) =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`;
  writeFileSync(patch, diffOf('docs/notes.md'));
  assert.equal(run('check-patch', patch).status, 0);
  writeFileSync(
    patch,
    diffOf('docs/notes.md') + diffOf('.github/workflows/ci.yml'),
  );
  const rejected = run('check-patch', patch);
  assert.equal(rejected.status, 1);
  assert.match(output(), /rejected<<.*\ntrue\n/);
  assert.match(rejected.stdout, /protected: \.github\/workflows\/ci\.yml/);
});

test('unknown command exits 2', () => {
  assert.equal(sandboxRun().run('deploy').status, 2);
});

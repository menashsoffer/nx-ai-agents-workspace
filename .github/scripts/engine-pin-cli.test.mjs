// Run: pnpm test:pipeline
// engine.mjs pin end to end: a local stand-in for the runner's OIDC endpoint
// and a fake `gh` for the GitHub API, so the pin job's real code path runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { ENGINE_REPOSITORY } from './engine-pin.mjs';
import { runFor } from './engine-test-run.mjs';

const BASE = 'b'.repeat(40);
const ENGINE = new URL('./engine.mjs', import.meta.url).pathname;

/** An unsigned JWT carrying `claims` (the engine only decodes it). */
const tokenOf = (claims) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'x'].join(
    '.',
  );

/** Runs `pin` with an OIDC token for `claims` and a gh that answers `reference`. */
async function pin({
  claims,
  reference = { object: { type: 'commit', sha: BASE } },
}) {
  const run = runFor({
    repository: 'menashsoffer/pipeline-sandbox',
    repositoryId: 101,
  });
  const engineDirectory = join(run.directory, 'engine');
  mkdirSync(engineDirectory);
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args],
      {
        cwd: engineDirectory,
        encoding: 'utf8',
      },
    ).trim();
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'engine');
  const commit = git('rev-parse', 'HEAD');
  const bin = join(run.directory, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\nprintf '%s' '${JSON.stringify(reference)}'\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const server = createServer((request, response) => {
    response.end(JSON.stringify({ value: tokenOf(claims(commit)) }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const event = JSON.parse(
    readFileSync(join(run.directory, 'event.json'), 'utf8'),
  );
  const child = spawn(
    process.execPath,
    [
      ENGINE,
      'pin',
      '--stage',
      'develop',
      '--workflow',
      'engine-develop.yml',
      '--engine-commit',
      commit,
      '--engine-dir',
      engineDirectory,
      '--resolve-base',
    ],
    {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: event.repository.full_name,
        GITHUB_REPOSITORY_ID: String(event.repository.id),
        GITHUB_EVENT_NAME: 'issues',
        GITHUB_EVENT_PATH: join(run.directory, 'event.json'),
        GITHUB_OUTPUT: join(run.directory, 'output.txt'),
        GH_TOKEN: 'test',
        ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${server.address().port}/token?x=1`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
      },
    },
  );
  let stdout = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  const status = await new Promise((resolve) => child.on('close', resolve));
  server.close();
  return { status, stdout, commit, outputValue: run.outputValue };
}

const honestClaims = (commit) => ({
  job_workflow_ref: `${ENGINE_REPOSITORY}/.github/workflows/engine-develop.yml@${commit}`,
  job_workflow_sha: commit,
  repository: 'menashsoffer/pipeline-sandbox',
});

test('pin: verified engine commit, target, base and branch from GitHub', async () => {
  const result = await pin({ claims: honestClaims });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.outputValue('commit'), result.commit);
  assert.equal(
    result.outputValue('repository'),
    'menashsoffer/pipeline-sandbox',
  );
  assert.equal(result.outputValue('issue'), '7');
  assert.equal(result.outputValue('base'), BASE);
  assert.equal(result.outputValue('branch'), 'issue-7-probe');
});

test('pin: a branch reference or another caller fails before any base is read', async () => {
  const branch = await pin({
    claims: (commit) => ({
      ...honestClaims(commit),
      job_workflow_ref: `${ENGINE_REPOSITORY}/.github/workflows/engine-develop.yml@refs/heads/main`,
    }),
  });
  assert.equal(branch.status, 1);
  assert.match(branch.stdout, /not called by this exact commit/);
  assert.equal(branch.outputValue('base'), undefined);
  const caller = await pin({
    claims: (commit) => ({
      ...honestClaims(commit),
      repository: 'someone/else',
    }),
  });
  assert.equal(caller.status, 1);
  assert.match(caller.stdout, /caller repository differs/);
});

test('pin: a default branch that does not point at a commit fails', async () => {
  const result = await pin({
    claims: honestClaims,
    reference: { object: { type: 'tag', sha: BASE } },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /does not point at a commit/);
  assert.equal(result.outputValue('base'), undefined);
});

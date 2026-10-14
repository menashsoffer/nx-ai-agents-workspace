// Run: pnpm test:pipeline
// engine.mjs check-output, check-commits and safe-note --kind output, end
// to end: the agent's output and the commits to push are scanned before
// anything is published, and a finding is posted only from closed sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffOf, runFor } from './engine-test-run.mjs';

const sandboxRun = () =>
  runFor({ repository: 'menashsoffer/pipeline-sandbox', repositoryId: 101 });

test('check-output: secrets in the agent JSON, the patch or the PR body', () => {
  const run = sandboxRun();
  const token = `ghp_${'Q'.repeat(36)}`;
  const result = join(run.directory, 'result.json');
  const patch = join(run.directory, 'changes.patch');
  const body = join(run.directory, 'pr-body.md');
  writeFileSync(
    result,
    JSON.stringify({ status: 'done', pr_title: 'Probe', pr_body: 'ok' }),
  );
  writeFileSync(patch, diffOf('SANDBOX_PROBE.md'));
  writeFileSync(body, 'A clean body.\n');
  const scan = (...extra) =>
    run.run(
      'check-output',
      '--stage',
      'develop',
      '--result',
      result,
      '--patch',
      patch,
      '--text',
      body,
      ...extra,
    );
  assert.equal(scan('--fail=true').status, 0);
  assert.equal(run.outputValue('is_clean'), 'true');
  for (const [file, content, field] of [
    [
      result,
      JSON.stringify({ status: 'done', pr_body: `use ${token}` }),
      'result.pr_body',
    ],
    [patch, `${diffOf('SANDBOX_PROBE.md')}+${token}\n`, 'patch.diff'],
    [body, `Body ${token}\n`, 'text.pr-body.md'],
  ]) {
    writeFileSync(file, content);
    const stopped = scan('--fail=true');
    assert.equal(stopped.status, 1, field);
    assert.equal(run.outputValue('is_clean'), 'false');
    assert.equal(run.outputValue('findings'), `${field}:github_token`);
    assert.ok(
      !stopped.stdout.includes(token) && !run.output().includes(token),
      field,
    );
    writeFileSync(
      result,
      JSON.stringify({ status: 'done', pr_title: 'Probe', pr_body: 'ok' }),
    );
    writeFileSync(patch, diffOf('SANDBOX_PROBE.md'));
    writeFileSync(body, 'A clean body.\n');
  }
  // without --fail it reports and leaves the decision to the workflow
  writeFileSync(body, `Body ${token}\n`);
  assert.equal(scan().status, 0);
  assert.equal(run.outputValue('is_clean'), 'false');
});

test('check-commits: a token in the committer of a commit to push fails', () => {
  const run = sandboxRun();
  const repository = join(run.directory, 'repository');
  mkdirSync(repository);
  const token = `ghp_${'C'.repeat(36)}`;
  const git = (environment, ...args) =>
    execFileSync('git', args, {
      cwd: repository,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Agent',
        GIT_AUTHOR_EMAIL: 'a@example.com',
        GIT_COMMITTER_NAME: 'Agent',
        GIT_COMMITTER_EMAIL: 'a@example.com',
        ...environment,
      },
      encoding: 'utf8',
    }).trim();
  git({}, 'init', '-q');
  git({}, 'commit', '-q', '--allow-empty', '-m', 'base');
  const base = git({}, 'rev-parse', 'HEAD');
  git({}, 'commit', '-q', '--allow-empty', '-m', 'clean');
  assert.equal(
    run.runIn(repository, 'check-commits', '--base', base, '--fail=true')
      .status,
    0,
  );
  git(
    { GIT_COMMITTER_NAME: `Agent ${token}` },
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'probe',
  );
  const stopped = run.runIn(
    repository,
    'check-commits',
    '--base',
    base,
    '--fail=true',
  );
  assert.equal(stopped.status, 1);
  assert.equal(run.outputValue('findings'), 'commit.committer:github_token');
  assert.ok(!stopped.stdout.includes(token));
});

test('safe-note output: forged findings with private text never reach the note', () => {
  const run = sandboxRun();
  const token = `ghp_${'F'.repeat(36)}`;
  const out = join(run.directory, 'outcome.json');
  const prompt = new URL('../prompts/develop.md', import.meta.url).pathname;
  const note = (findings) => {
    const result = run.run(
      'safe-note',
      '--kind',
      'output',
      '--stage',
      'develop',
      '--findings',
      findings,
      '--prompt',
      prompt,
      '--prompt-name',
      'develop.md',
      '--out',
      out,
    );
    assert.equal(result.status, 0, result.stdout);
    return JSON.parse(readFileSync(out, 'utf8'));
  };
  assert.deepEqual(note('patch.subject:github_token').details, [
    'secret_in_output: patch.subject (github_token)',
  ]);
  for (const forged of [
    `result.pr_body:${token}`,
    `my home address:github_token`,
    `text.${token}:jwt`,
  ]) {
    const text = JSON.stringify(note(forged));
    assert.ok(!text.includes(token) && !text.includes('home address'), forged);
    assert.match(text, /details withheld/);
  }
});

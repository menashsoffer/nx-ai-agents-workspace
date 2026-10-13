// Run: pnpm test:pipeline
// engine.mjs run-checks and check-output end to end, on real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffOf, runFor } from './engine-test-run.mjs';

const sandboxRun = () =>
  runFor({ repository: 'menashsoffer/pipeline-sandbox', repositoryId: 101 });

const PROFILE = {
  schema: 1,
  name: 'pipeline-sandbox',
  summary: 'Documentation only.',
  commands: { setup: [], verify: [] },
  agentCommands: [],
  checks: [
    'patch-not-empty',
    'writable-paths',
    'markdown-files',
    'exact-content',
  ],
  paths: { protected: [], writable: ['SANDBOX_PROBE.md'] },
  limits: { maxFiles: 1, maxLines: 50 },
};
const EXPECTED = '# Sandbox probe\n\nHello.\n';
const ISSUE = {
  number: 7,
  body: 'Write the probe.\n\n```expected SANDBOX_PROBE.md\n# Sandbox probe\n\nHello.\n```\n',
};

/** A run with a target folder, the profile, the patch and the issue in place. */
function prepared() {
  const run = sandboxRun();
  const target = join(run.directory, 'target');
  mkdirSync(target);
  const files = {
    profile: join(run.directory, 'profile.json'),
    patch: join(run.directory, 'changes.patch'),
    issue: join(run.directory, 'issue.json'),
  };
  writeFileSync(files.profile, JSON.stringify(PROFILE));
  writeFileSync(files.patch, diffOf('SANDBOX_PROBE.md'));
  writeFileSync(files.issue, JSON.stringify(ISSUE));
  const checks = () =>
    run.runIn(
      target,
      'run-checks',
      '--profile',
      files.profile,
      '--patch',
      files.patch,
      '--issue',
      files.issue,
    );
  return { ...run, target, files, checks };
}

test('run-checks: the exact expected content in a regular file passes', () => {
  const run = prepared();
  writeFileSync(join(run.target, 'SANDBOX_PROBE.md'), EXPECTED);
  const result = run.checks();
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /pass exact-content/);
});

test('run-checks: SANDBOX_PROBE.md as a symlink to /etc/hostname is rejected', () => {
  const run = prepared();
  symlinkSync('/etc/hostname', join(run.target, 'SANDBOX_PROBE.md'));
  const result = run.checks();
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /regular-files: symbolic link: SANDBOX_PROBE\.md/,
  );
});

test('run-checks: a link in a parent folder is rejected too', () => {
  const run = prepared();
  writeFileSync(
    run.files.profile,
    JSON.stringify({ ...PROFILE, checks: ['patch-not-empty'] }),
  );
  writeFileSync(run.files.patch, diffOf('docs/SANDBOX_PROBE.md'));
  mkdirSync(join(run.directory, 'elsewhere'));
  writeFileSync(join(run.directory, 'elsewhere/SANDBOX_PROBE.md'), EXPECTED);
  symlinkSync(join(run.directory, 'elsewhere'), join(run.target, 'docs'));
  const result = run.checks();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /symbolic link: docs\/SANDBOX_PROBE\.md/);
});

test('run-checks: valid Markdown that is not the task content fails', () => {
  const run = prepared();
  writeFileSync(
    join(run.target, 'SANDBOX_PROBE.md'),
    '# Sandbox probe\n\nSomething else.\n',
  );
  const result = run.checks();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /exact-content: content differs/);
});

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
    [patch, `${diffOf('SANDBOX_PROBE.md')}+${token}\n`, 'patch'],
    [body, `Body ${token}\n`, 'pr-body.md'],
  ]) {
    writeFileSync(file, content);
    const stopped = scan('--fail=true');
    assert.equal(stopped.status, 1, field);
    assert.equal(run.outputValue('is_clean'), 'false');
    assert.match(
      run.outputValue('outcome'),
      new RegExp(`secret_in_output: ${field.replace('.', '\\.')}`),
    );
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

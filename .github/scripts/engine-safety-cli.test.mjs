// Run: pnpm test:pipeline
// engine.mjs run-checks and check-output end to end, on real files.
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const prompt = new URL('../prompts/engine-develop.md', import.meta.url)
    .pathname;
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
      'engine-develop.md',
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

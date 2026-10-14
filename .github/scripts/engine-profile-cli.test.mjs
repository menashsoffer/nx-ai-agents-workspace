// Run: pnpm test:pipeline
// engine.mjs commands that read the target profile, end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffOf, runFor, writeProfile } from './engine-test-run.mjs';

const sandboxRun = () =>
  runFor({ repository: 'menashsoffer/pipeline-sandbox', repositoryId: 101 });

/** A target checkout with `files` written into it. */
function targetWith(directory, files) {
  const target = join(directory, 'target');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(target, path, '..'), { recursive: true });
    writeFileSync(join(target, path), content);
  }
  mkdirSync(target, { recursive: true });
  return target;
}

const DOCS_PROFILE = {
  schema: 1,
  name: 'docs-target',
  summary: 'Documentation only.',
  commands: { verify: [] },
  checks: ['patch-not-empty', 'writable-paths', 'markdown-files'],
  paths: { writable: ['SANDBOX_PROBE.md'] },
  limits: { maxFiles: 1, maxLines: 20 },
};

test('load-profile: valid profile, outputs for the workflow', () => {
  const { directory, run, output } = sandboxRun();
  const target = targetWith(directory, {
    '.github/pipeline-profile.json': JSON.stringify(DOCS_PROFILE),
  });
  const out = join(directory, 'normalized.json');
  const result = run('load-profile', '--target-dir', target, '--out', out);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).name, 'docs-target');
  assert.match(output(), /has_checks<<.*\ntrue\n/);
  assert.match(output(), /has_verify<<.*\nfalse\n/);
  assert.match(output(), /allowed_tools<<.*\nRead,Glob,Grep,/);
});

test('load-profile: missing, broken, unknown field or engine override fail', () => {
  const { directory, run } = sandboxRun();
  const load = (content) => {
    const target = targetWith(
      directory,
      content === undefined
        ? {}
        : {
            '.github/pipeline-profile.json': content,
          },
    );
    return run(
      'load-profile',
      '--target-dir',
      target,
      '--out',
      join(directory, 'p.json'),
    );
  };
  const missing = runFor({ repository: 'a/b', repositoryId: 1 });
  const absent = missing.run(
    'load-profile',
    '--target-dir',
    missing.directory,
    '--out',
    '/dev/null',
  );
  assert.equal(absent.status, 1);
  assert.match(absent.stdout, /pipeline-profile\.json is missing/);
  assert.match(load('{ not json').stdout, /is not valid JSON/);
  const unknown = load(JSON.stringify({ ...DOCS_PROFILE, extra: 1 }));
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /profile\.extra is not a known field/);
  const override = load(
    JSON.stringify({ ...DOCS_PROFILE, 'engine-ref': 'main' }),
  );
  assert.equal(override.status, 1);
  assert.match(override.stdout, /cannot set the engine version/);
  const badCommand = load(
    JSON.stringify({
      ...DOCS_PROFILE,
      commands: { verify: [['bash', 'install.sh']] },
    }),
  );
  assert.equal(badCommand.status, 1);
  assert.match(badCommand.stdout, /program bash is not allowed/);
});

test('run-checks: passes on the probe file, fails on an empty or wrong change', () => {
  const { directory, runIn } = sandboxRun();
  const target = targetWith(directory, {
    'SANDBOX_PROBE.md': '# Probe\n\nline\n',
  });
  const profile = join(directory, 'profile.json');
  writeFileSync(
    profile,
    JSON.stringify({
      ...DOCS_PROFILE,
      paths: { protected: [], writable: ['SANDBOX_PROBE.md'] },
    }),
  );
  const patch = join(directory, 'changes.patch');
  writeFileSync(patch, diffOf('SANDBOX_PROBE.md'));
  assert.equal(
    runIn(target, 'run-checks', '--profile', profile, '--patch', patch).status,
    0,
  );
  writeFileSync(patch, '');
  const empty = runIn(
    target,
    'run-checks',
    '--profile',
    profile,
    '--patch',
    patch,
  );
  assert.equal(empty.status, 1);
  assert.match(empty.stdout, /patch-not-empty: nothing to check/);
  writeFileSync(patch, diffOf('README.md'));
  const wrong = runIn(
    target,
    'run-checks',
    '--profile',
    profile,
    '--patch',
    patch,
  );
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout, /writable-paths: not writable: README\.md/);
});

test('run-commands setup: argv without a shell, and no tokens in the environment', () => {
  const { directory, runIn } = sandboxRun();
  const target = targetWith(directory, {
    'scripts/check.mjs':
      "import { writeFileSync } from 'node:fs';\nwriteFileSync('seen.json', JSON.stringify(Object.keys(process.env)));\n",
  });
  const check = ['node', 'scripts/check.mjs'];
  const profile = writeProfile(
    directory,
    {},
    { commands: { setup: [check], verify: [check] } },
  );
  const result = runIn(
    target,
    'run-commands',
    '--kind',
    'setup',
    '--profile',
    profile,
  );
  assert.equal(result.status, 0, result.stdout);
  const seen = JSON.parse(readFileSync(join(target, 'seen.json'), 'utf8'));
  assert.ok(!seen.includes('GITHUB_TOKEN'));
  assert.ok(!seen.some((name) => /TOKEN|SECRET|KEY/.test(name)), seen.join());
  writeFileSync(join(target, 'scripts/check.mjs'), 'process.exit(3);\n');
  assert.equal(
    runIn(target, 'run-commands', '--kind', 'setup', '--profile', profile)
      .status,
    1,
  );
});

test('classify-plan: the profile decides; protected paths stop the plan', () => {
  const { directory, run, output } = sandboxRun();
  const profile = writeProfile(directory, { writable: ['SANDBOX_PROBE.md'] });
  const result = join(directory, 'result.json');
  const planned = (file) => ({
    status: 'planned',
    problem: 'none',
    questions: [],
    details: [],
    signals: { embedded_instructions: false, needs_secrets_ci_infra: false },
    spec: {
      goal: 'g',
      acceptance_criteria: [{ text: 't', testable: true }],
      rtl_accessibility: 'Not applicable.',
      test_plan: 'p',
      out_of_scope: 'None',
      assumptions: 'None',
    },
    plan: {
      approach: 'a',
      changes: [{ project: 'target', file, change: 'c', lines: 1 }],
      tests: 't',
      risks: 'r',
      definition_of_done: 'd',
    },
  });
  const classify = () =>
    run(
      'classify-plan',
      '--job-result',
      'success',
      '--profile',
      profile,
      '--result',
      result,
      '--prompt-version',
      'engine-plan.md@1',
      '--out',
      join(directory, 'outcome.json'),
      '--spec-out',
      join(directory, 'spec.md'),
      '--plan-out',
      join(directory, 'plan.md'),
    );
  writeFileSync(result, JSON.stringify(planned('SANDBOX_PROBE.md')));
  assert.equal(classify().status, 0);
  assert.match(output(), /result<<.*\nsuccess\n/);
  assert.match(
    readFileSync(join(directory, 'plan.md'), 'utf8'),
    /SANDBOX_PROBE\.md/,
  );
  writeFileSync(result, JSON.stringify(planned('.github/workflows/x.yml')));
  classify();
  const outcome = JSON.parse(
    readFileSync(join(directory, 'outcome.json'), 'utf8'),
  );
  assert.equal(outcome.problem, 'protected_surface');
});

test('render-prompt: engine prompt + profile + context + untrusted issue', () => {
  const { directory, run, output } = sandboxRun();
  const profile = writeProfile(directory, { writable: ['SANDBOX_PROBE.md'] });
  const issue = join(directory, 'issue.json');
  writeFileSync(issue, JSON.stringify({ title: 'Probe', body: 'one line' }));
  const prompt = new URL('../prompts/engine-plan.md', import.meta.url).pathname;
  const result = run(
    'render-prompt',
    '--prompt',
    prompt,
    '--profile',
    profile,
    '--context',
    'repository=menashsoffer/pipeline-sandbox',
    '--context',
    'issue=#7',
    '--issue',
    issue,
  );
  assert.equal(result.status, 0, result.stdout);
  assert.match(output(), /## Target profile/);
  assert.match(output(), /- prompt version: engine-plan\.md@2/);
  assert.match(output(), /version<<.*\n2\n/);
  const forged = run(
    'render-prompt',
    '--prompt',
    prompt,
    '--profile',
    profile,
    '--context',
    'target=evil/repo',
    '--issue',
    issue,
  );
  assert.equal(forged.status, 1);
});

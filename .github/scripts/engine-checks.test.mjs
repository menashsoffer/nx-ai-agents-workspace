// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from './engine-checks.mjs';
import { validateProfile } from './engine-profile.mjs';

const docsProfile = (
  checks = ['patch-not-empty', 'writable-paths', 'markdown-files'],
) =>
  validateProfile({
    schema: 1,
    name: 'docs-target',
    summary: 'Documentation only.',
    commands: { verify: [] },
    checks,
    paths: { writable: ['SANDBOX_PROBE.md'] },
  }).profile;

const filesOf = (files) => (path) =>
  Object.hasOwn(files, path) ? Buffer.from(files[path]) : null;

const run = (changedPaths, files, profile = docsProfile()) =>
  runChecks({ profile, changedPaths, readFile: filesOf(files) });
const failing = (results) =>
  results.filter((result) => !result.isPassing).map((result) => result.name);

test('runChecks: one Markdown change on the writable file passes', () => {
  const results = run(['SANDBOX_PROBE.md'], {
    'SANDBOX_PROBE.md': '# Probe\n\nOne line.\n',
  });
  assert.deepEqual(failing(results), []);
  assert.ok(results.every((result) => result.checkedCount === 1));
});

test('runChecks: an empty set never passes', () => {
  const results = run([], {});
  assert.deepEqual(failing(results), [
    'patch-not-empty',
    'writable-paths',
    'markdown-files',
  ]);
  for (const result of results)
    assert.deepEqual(result.problems, ['nothing to check']);
  // a deleted file leaves nothing for the Markdown check either
  assert.deepEqual(failing(run(['SANDBOX_PROBE.md'], {})), ['markdown-files']);
  // and a profile with no checks is not a pass
  const none = { ...docsProfile(), checks: [] };
  assert.deepEqual(
    failing(
      runChecks({ profile: none, changedPaths: ['x'], readFile: () => null }),
    ),
    ['checks'],
  );
});

test('runChecks: other paths, other file types and active HTML fail', () => {
  assert.deepEqual(failing(run(['README.md'], { 'README.md': '# Readme\n' })), [
    'writable-paths',
  ]);
  assert.deepEqual(
    failing(
      run(['SANDBOX_PROBE.md', 'scripts/x.mjs'], {
        'SANDBOX_PROBE.md': 'ok\n',
        'scripts/x.mjs': 'x',
      }),
    ),
    ['writable-paths', 'markdown-files'],
  );
  for (const body of [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[x](javascript:alert(1))',
    '   \n',
  ])
    assert.deepEqual(
      failing(run(['SANDBOX_PROBE.md'], { 'SANDBOX_PROBE.md': body })),
      ['markdown-files'],
      body,
    );
  assert.deepEqual(
    failing(
      run(['.github/pipeline-profile.json'], {
        '.github/pipeline-profile.json': '{}',
      }),
    ),
    ['writable-paths', 'markdown-files'],
  );
});

test('runChecks: invalid UTF-8 and oversized files fail', () => {
  const invalid = runChecks({
    profile: docsProfile(['markdown-files']),
    changedPaths: ['SANDBOX_PROBE.md'],
    readFile: () => Buffer.from([0x23, 0x20, 0xff, 0xfe]),
  });
  assert.match(invalid[0].problems.join(), /not valid UTF-8/);
  const large = run(
    ['SANDBOX_PROBE.md'],
    { 'SANDBOX_PROBE.md': 'a'.repeat(200_001) },
    docsProfile(['markdown-files']),
  );
  assert.match(large[0].problems.join(), /larger than/);
});

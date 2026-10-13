// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from './engine-checks.mjs';
import { parseExpectations } from './engine-expectations.mjs';
import { validateProfile } from './engine-profile.mjs';

const ALL = ['patch-not-empty', 'writable-paths', 'markdown-files'];
const docsProfile = (checks = ALL) =>
  validateProfile({
    schema: 1,
    name: 'docs-target',
    summary: 'Documentation only.',
    commands: { verify: [] },
    checks,
    paths: { writable: ['SANDBOX_PROBE.md'] },
  }).profile;

/** `inspect` over an in-memory tree; a value of `{ kind }` stands for itself. */
const inspectOf = (files) => (path) => {
  if (!Object.hasOwn(files, path)) return { kind: 'missing' };
  const value = files[path];
  return typeof value === 'string' || Buffer.isBuffer(value)
    ? { kind: 'file', content: Buffer.from(value) }
    : value;
};

const run = (changedPaths, files, profile = docsProfile(), expectations = []) =>
  runChecks({ profile, changedPaths, inspect: inspectOf(files), expectations });
const failing = (results) =>
  results.filter((result) => !result.isPassing).map((result) => result.name);

test('runChecks: one Markdown change on the writable file passes', () => {
  const results = run(['SANDBOX_PROBE.md'], {
    'SANDBOX_PROBE.md': '# Probe\n\nOne line.\n',
  });
  assert.deepEqual(failing(results), []);
  assert.deepEqual(
    results.map((result) => result.name),
    ['regular-files', 'file-length', ...ALL],
  );
});

test('runChecks: an empty set never passes, mandatory checks included', () => {
  const results = run([], {});
  assert.deepEqual(failing(results), ['regular-files', 'file-length', ...ALL]);
  for (const result of results)
    assert.deepEqual(result.problems, ['nothing to check']);
  assert.deepEqual(failing(run(['SANDBOX_PROBE.md'], {})), ['markdown-files']);
  // a profile with no checks of its own still runs the mandatory ones
  assert.deepEqual(failing(run([], {}, { ...docsProfile(), checks: [] })), [
    'regular-files',
    'file-length',
  ]);
});

test('runChecks: a symbolic link or a non-file is rejected', () => {
  const link = run(['SANDBOX_PROBE.md'], {
    'SANDBOX_PROBE.md': { kind: 'symlink' },
  });
  assert.deepEqual(failing(link), ['regular-files', 'markdown-files']);
  assert.match(link[0].problems[0], /symbolic link: SANDBOX_PROBE\.md/);
  const other = run(['SANDBOX_PROBE.md'], {
    'SANDBOX_PROBE.md': { kind: 'other' },
  });
  assert.deepEqual(failing(other), ['regular-files', 'markdown-files']);
});

test('runChecks: no changed file may exceed 400 lines', () => {
  const lines = (count) => 'line\n'.repeat(count);
  assert.deepEqual(
    failing(run(['SANDBOX_PROBE.md'], { 'SANDBOX_PROBE.md': lines(400) })),
    [],
  );
  const long = run(['SANDBOX_PROBE.md'], { 'SANDBOX_PROBE.md': lines(401) });
  assert.deepEqual(failing(long), ['file-length']);
  assert.match(long[1].problems[0], /401 lines \(cap 400\)/);
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
});

test('runChecks: invalid UTF-8 and oversized files fail', () => {
  const invalid = run(
    ['SANDBOX_PROBE.md'],
    { 'SANDBOX_PROBE.md': Buffer.from([0x23, 0x20, 0xff, 0xfe]) },
    docsProfile(['markdown-files']),
  );
  assert.match(invalid.at(-1).problems.join(), /not valid UTF-8/);
  const large = run(
    ['SANDBOX_PROBE.md'],
    { 'SANDBOX_PROBE.md': 'a'.repeat(200_001) },
    docsProfile(['markdown-files']),
  );
  assert.match(large.at(-1).problems.join(), /larger than/);
});

const EXPECTED = '# Sandbox probe\n\nHello from issue 7.\n';
const issueBody = [
  'Please write the probe.',
  '',
  '```expected SANDBOX_PROBE.md',
  '# Sandbox probe',
  '',
  'Hello from issue 7.',
  '```',
].join('\n');

test('exact-content: the file must hold exactly what the task states', () => {
  const profile = docsProfile([...ALL, 'exact-content']);
  const { expectations, problems } = parseExpectations(issueBody);
  assert.deepEqual(problems, []);
  const check = (content) =>
    failing(
      run(
        ['SANDBOX_PROBE.md'],
        { 'SANDBOX_PROBE.md': content },
        profile,
        expectations,
      ),
    );
  assert.deepEqual(check(EXPECTED), []);
  // valid Markdown that is not the task's content fails
  assert.deepEqual(check('# Sandbox probe\n\nSomething else.\n'), [
    'exact-content',
  ]);
  assert.deepEqual(check(EXPECTED.trimEnd()), ['exact-content']);
  assert.deepEqual(check(`${EXPECTED}extra\n`), ['exact-content']);
});

test('exact-content: no expectation, or an unexpected file, fails', () => {
  const profile = docsProfile(['exact-content']);
  const none = run(
    ['SANDBOX_PROBE.md'],
    { 'SANDBOX_PROBE.md': EXPECTED },
    profile,
    [],
  );
  assert.deepEqual(none.at(-1).problems, [
    'the task states no expected content',
  ]);
  const { expectations } = parseExpectations(issueBody);
  const extra = run(
    ['SANDBOX_PROBE.md', 'NOTES.md'],
    { 'SANDBOX_PROBE.md': EXPECTED, 'NOTES.md': 'x\n' },
    profile,
    expectations,
  );
  assert.match(
    extra.at(-1).problems.join(),
    /changed but not expected: NOTES\.md/,
  );
  const missing = run([], {}, profile, expectations);
  assert.match(
    missing.at(-1).problems.join(),
    /expected but not changed: SANDBOX_PROBE\.md/,
  );
});

test('parseExpectations: strict blocks only', () => {
  assert.deepEqual(parseExpectations('no blocks here'), {
    expectations: [],
    problems: [],
  });
  assert.deepEqual(parseExpectations('```expected a.md\nx'), {
    expectations: [],
    problems: ['the expected block for a.md is not closed'],
  });
  const twice = parseExpectations(
    '```expected a.md\nx\n```\n```expected a.md\ny\n```',
  );
  assert.deepEqual(twice.problems, ['a.md is expected twice']);
  for (const path of ['../etc/passwd', '/etc/hostname', 'docs/*.md'])
    assert.equal(
      parseExpectations(`\`\`\`expected ${path}\nx\n\`\`\``).problems.length,
      1,
      path,
    );
  // another info string is ordinary Markdown, and CRLF bodies parse the same
  assert.deepEqual(parseExpectations('```md\nx\n```').expectations, []);
  assert.deepEqual(
    parseExpectations('```expected a.md\r\nx\r\n```').expectations,
    [{ path: 'a.md', content: 'x\n' }],
  );
});

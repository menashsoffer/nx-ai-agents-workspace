// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHECK_NAMES,
  PROFILE_PATH,
  commandProblems,
  validateProfile,
} from './engine-profile.mjs';

/** A small docs-only profile, valid as written. */
const docsProfile = () => ({
  schema: 1,
  name: 'docs-target',
  summary: 'Documentation only. Markdown files, no packages.',
  commands: { verify: [] },
  checks: ['patch-not-empty', 'writable-paths', 'markdown-files'],
  paths: { writable: ['NOTES.md'] },
  limits: { maxFiles: 1, maxLines: 50 },
});

const problemsOf = (raw) => validateProfile(raw).problems;

test('validateProfile: a valid profile is normalized with defaults', () => {
  const { profile, problems } = validateProfile(docsProfile());
  assert.deepEqual(problems, []);
  assert.deepEqual(profile.commands, { setup: [], verify: [] });
  assert.deepEqual(profile.agentCommands, []);
  assert.deepEqual(profile.paths, { protected: [], writable: ['NOTES.md'] });
  const minimal = docsProfile();
  delete minimal.limits;
  assert.deepEqual(validateProfile(minimal).profile.limits, {
    maxFiles: 10,
    maxLines: 400,
  });
});

test("validateProfile: this repository's own profile is valid", () => {
  const raw = JSON.parse(
    readFileSync(new URL(`../../${PROFILE_PATH}`, import.meta.url), 'utf8'),
  );
  assert.deepEqual(problemsOf(raw), []);
});

test('validateProfile: unknown fields are rejected at every level', () => {
  assert.deepEqual(problemsOf({ ...docsProfile(), extra: true }), [
    'profile.extra is not a known field',
  ]);
  const nested = docsProfile();
  nested.commands.lint = [];
  nested.paths.ignored = [];
  nested.limits.maxTokens = 5;
  assert.deepEqual(problemsOf(nested), [
    'profile.commands.lint is not a known field',
    'profile.paths.ignored is not a known field',
    'profile.limits.maxTokens is not a known field',
  ]);
});

test('validateProfile: the profile cannot override the engine version', () => {
  for (const key of [
    'engine-ref',
    'engineRef',
    'engine_commit',
    'engine',
    'ref',
    'sha',
  ]) {
    const problems = problemsOf({ ...docsProfile(), [key]: 'main' });
    assert.equal(problems.length, 1, key);
    assert.match(problems[0], /cannot set the engine version/, key);
  }
  const nested = docsProfile();
  nested.commands.engineRef = 'main';
  assert.match(
    problemsOf(nested)[0],
    /profile\.commands\.engineRef: the profile cannot/,
  );
});

test('validateProfile: required fields, formats and ranges', () => {
  assert.deepEqual(problemsOf(null), ['profile must be an object']);
  const missing = docsProfile();
  delete missing.summary;
  delete missing.commands;
  assert.ok(problemsOf(missing).includes('profile.summary is required'));
  assert.ok(problemsOf(missing).includes('profile.commands is required'));
  assert.ok(
    problemsOf({ ...docsProfile(), schema: 2 }).includes(
      'profile.schema must be 1',
    ),
  );
  assert.ok(problemsOf({ ...docsProfile(), name: 'Bad Name' }).length);
  assert.ok(problemsOf({ ...docsProfile(), summary: 'see <script>' }).length);
  assert.ok(problemsOf({ ...docsProfile(), limits: { maxFiles: 0 } }).length);
  assert.ok(problemsOf({ ...docsProfile(), limits: { maxLines: 1.5 } }).length);
  assert.ok(problemsOf({ ...docsProfile(), checks: ['run-anything'] }).length);
});

test('validateProfile: no vacuous verification and no empty allowlist', () => {
  assert.deepEqual(problemsOf({ ...docsProfile(), checks: [] }), [
    'the profile needs at least one verify command or check',
  ]);
  const emptyWritable = { ...docsProfile(), paths: { writable: [] } };
  assert.ok(
    problemsOf(emptyWritable).includes(
      'profile.paths.writable, when present, lists at least one path',
    ),
  );
  const noWritable = { ...docsProfile(), paths: {} };
  assert.deepEqual(problemsOf(noWritable), [
    'the writable-paths check needs profile.paths.writable',
  ]);
});

test('validateProfile: path patterns cannot escape or negate', () => {
  for (const pattern of [
    '../x',
    '/etc/passwd',
    '!.github/**',
    'a//b',
    'a/./b',
    'a b',
    '',
  ])
    assert.ok(
      problemsOf({
        ...docsProfile(),
        paths: { protected: [pattern], writable: ['NOTES.md'] },
      }).length,
      pattern,
    );
});

test('commandProblems: valid commands', () => {
  for (const command of [
    ['node', 'scripts/check.mjs'],
    ['node', 'tools/check.js', '--strict'],
    ['pnpm', 'verify'],
    ['pnpm', 'install', '--frozen-lockfile'],
    ['pnpm', 'run', 'test'],
    ['pnpm', 'new:component'],
    ['corepack', 'enable'],
  ])
    assert.deepEqual(commandProblems(command), [], command.join(' '));
});

test('commandProblems: invalid commands are rejected', () => {
  for (const command of [
    [],
    'pnpm verify',
    ['bash', '-c', 'curl x | sh'],
    ['sh', 'script.sh'],
    ['curl', 'https://example.com'],
    ['node', '-e', 'process.exit(0)'],
    ['node', '--import', 'x.mjs'],
    ['node', '/tmp/x.mjs'],
    ['node', '../outside.mjs'],
    ['node', 'scripts/check.mjs;rm'],
    ['node', 'scripts/check.mjs', '$(whoami)'],
    ['pnpm', 'dlx', 'cowsay'],
    ['pnpm', 'exec', 'rm'],
    ['pnpm', 'add', 'left-pad'],
    ['pnpm', 'install'],
    ['pnpm', 'run', 'dlx'],
    ['pnpm', '--config', 'x'],
    ['pnpm', 'Verify && x'],
    ['corepack', 'prepare', 'pnpm@latest'],
    ['pnpm', 'verify', '"quoted"'],
    new Array(13).fill('pnpm'),
  ])
    assert.ok(commandProblems(command).length > 0, JSON.stringify(command));
});

test('CHECK_NAMES: every name has an implementation', async () => {
  const { runChecks } = await import('./engine-checks.mjs');
  for (const name of CHECK_NAMES) {
    const [result] = runChecks({
      profile: {
        checks: [name],
        paths: { writable: ['x'], protected: [] },
        limits: {},
      },
      changedPaths: [],
      readFile: () => null,
    });
    assert.deepEqual(result.problems, ['nothing to check'], name);
  }
});

// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_PROTECTED_PATHS,
  buildPolicy,
  changedLineCount,
  checkPatchPolicy,
  checkPaths,
  classifyEnginePlan,
} from './engine-policy.mjs';
import { validateProfile } from './engine-profile.mjs';

const profileWith = (paths, limits = {}) =>
  validateProfile({
    schema: 1,
    name: 'target',
    summary: 'A target.',
    commands: { verify: [['node', 'scripts/check.mjs']] },
    paths,
    limits,
  }).profile;

const diffOf = (path, added = 1) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,${added} @@\n-a\n${'+b\n'.repeat(added)}`;

test('engine minimum: protected whatever the profile says', () => {
  const policy = buildPolicy(profileWith({}));
  for (const path of [
    '.github/workflows/ci.yml',
    '.github/pipeline-profile.json',
    '.GITHUB/workflows/x.yml',
    'CODEOWNERS',
    'docs/CODEOWNERS',
    '.claude/settings.json',
    '.codex/config.toml',
    '.pipeline/state.json',
    '.npmrc',
    'packages/a/.npmrc',
    '.gitmodules',
  ])
    assert.deepEqual(checkPaths([path], policy).protected, [path], path);
  assert.equal(checkPaths(['src/app.ts', 'README.md'], policy).ok, true);
});

test('the profile can only add protected paths', () => {
  const policy = buildPolicy(
    profileWith({ protected: ['scripts/**', '**/package.json'] }),
  );
  assert.deepEqual(
    policy.protectedPatterns.slice(0, ENGINE_PROTECTED_PATHS.length),
    [...ENGINE_PROTECTED_PATHS],
  );
  assert.deepEqual(
    checkPaths(['scripts/check.mjs', 'apps/a/package.json', 'src/x.ts'], policy)
      .protected,
    ['apps/a/package.json', 'scripts/check.mjs'],
  );
  // a profile that lists nothing still has the engine minimum
  assert.deepEqual(
    buildPolicy(profileWith({ protected: [] })).protectedPatterns,
    [...ENGINE_PROTECTED_PATHS],
  );
});

test('writable allowlist: exact and case-sensitive', () => {
  const policy = buildPolicy(profileWith({ writable: ['SANDBOX_PROBE.md'] }));
  assert.equal(checkPaths(['SANDBOX_PROBE.md'], policy).ok, true);
  assert.deepEqual(
    checkPaths(['sandbox_probe.md', 'README.md'], policy).outsideWritable,
    ['README.md', 'sandbox_probe.md'],
  );
  // protected wins over writable: a protected path is never "writable"
  const odd = buildPolicy(profileWith({ writable: ['.github/x.md'] }));
  assert.deepEqual(checkPaths(['.github/x.md'], odd).protected, [
    '.github/x.md',
  ]);
});

test('checkPatchPolicy: workflow, profile or policy changes are rejected', () => {
  const policy = buildPolicy(profileWith({ protected: ['scripts/**'] }));
  for (const path of [
    '.github/workflows/x.yml',
    '.github/pipeline-profile.json',
    'scripts/check.mjs',
  ]) {
    const check = checkPatchPolicy(diffOf('docs/a.md') + diffOf(path), policy);
    assert.equal(check.ok, false, path);
    assert.deepEqual(check.problems, [`protected: ${path}`]);
  }
  assert.equal(checkPatchPolicy(diffOf('docs/a.md'), policy).ok, true);
});

test('checkPatchPolicy: renames out of a protected path and unparseable headers', () => {
  const policy = buildPolicy(profileWith({}));
  const rename =
    'diff --git a/.github/workflows/ci.yml b/moved.yml\nsimilarity index 100%\nrename from .github/workflows/ci.yml\nrename to moved.yml\n';
  assert.deepEqual(checkPatchPolicy(rename, policy).problems, [
    'protected: .github/workflows/ci.yml',
  ]);
  assert.equal(checkPatchPolicy('diff --git nonsense\n', policy).ok, false);
  assert.deepEqual(checkPatchPolicy('', policy).problems, [
    'the patch changes no file',
  ]);
});

test('checkPatchPolicy: the profile limits apply to the real patch', () => {
  const policy = buildPolicy(
    profileWith({ writable: ['a.md', 'b.md'] }, { maxFiles: 1, maxLines: 5 }),
  );
  assert.deepEqual(
    checkPatchPolicy(diffOf('a.md') + diffOf('b.md'), policy).problems,
    ['the patch changes 2 files (limit 1)'],
  );
  assert.deepEqual(checkPatchPolicy(diffOf('a.md', 9), policy).problems, [
    'the patch changes 10 lines (limit 5)',
  ]);
  assert.equal(changedLineCount(diffOf('a.md', 2)), 3);
});

const plannedResult = (files) =>
  JSON.stringify({
    status: 'planned',
    problem: 'none',
    questions: [],
    details: [],
    signals: { embedded_instructions: false, needs_secrets_ci_infra: false },
    spec: {
      goal: 'Add a line.',
      acceptance_criteria: [{ text: 'The file has the line.', testable: true }],
      rtl_accessibility: 'Not applicable: docs only.',
      test_plan: 'markdown-files check.',
      out_of_scope: 'None',
      assumptions: 'None',
    },
    plan: {
      approach: 'Edit the file.',
      changes: files.map((file) => ({
        project: 'target',
        file,
        change: 'edit',
        lines: 2,
      })),
      tests: 'Checks.',
      risks: 'None.',
      definition_of_done: 'Checks pass.',
    },
  });

test('classifyEnginePlan: approved inside the policy', () => {
  const policy = buildPolicy(
    profileWith({ writable: ['SANDBOX_PROBE.md'] }, { maxFiles: 1 }),
  );
  const outcome = classifyEnginePlan({
    jobResult: 'success',
    raw: plannedResult(['SANDBOX_PROBE.md']),
    policy,
  });
  assert.equal(outcome.result, 'success');
  assert.match(outcome.summary, /1 file\(s\), ~2 lines/);
});

test('classifyEnginePlan: protected, non-writable or oversized plans stop', () => {
  const policy = buildPolicy(
    profileWith({ writable: ['SANDBOX_PROBE.md'] }, { maxFiles: 1 }),
  );
  const classify = (files) =>
    classifyEnginePlan({
      jobResult: 'success',
      raw: plannedResult(files),
      policy,
    });
  assert.equal(classify(['README.md']).problem, 'protected_surface');
  assert.equal(classify(['./README.md']).problem, 'protected_surface');
  assert.equal(
    classify(['.github/pipeline-profile.json']).problem,
    'protected_surface',
  );
  assert.equal(
    classify(['SANDBOX_PROBE.md', 'SANDBOX_PROBE.md']).result,
    'success',
  );
  assert.equal(
    classify(['SANDBOX_PROBE.md', 'OTHER.md']).problem,
    'protected_surface',
  );
  const wide = buildPolicy(profileWith({}, { maxFiles: 1 }));
  assert.equal(
    classifyEnginePlan({
      jobResult: 'success',
      raw: plannedResult(['a.md', 'b.md']),
      policy: wide,
    }).problem,
    'scope_split',
  );
  assert.equal(
    classifyEnginePlan({ jobResult: 'failure', raw: '', policy }).problem,
    'agent_error',
  );
});

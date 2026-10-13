// Run: pnpm test:pipeline
// The pipeline-sandbox profile run through the engine's policy and checks:
// the pilot's only acceptable result is the task's exact content in
// SANDBOX_PROBE.md, a regular file. Simulated here, not end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runChecks } from './engine-checks.mjs';
import { parseExpectations } from './engine-expectations.mjs';
import {
  buildPolicy,
  checkPatchPolicy,
  classifyEnginePlan,
} from './engine-policy.mjs';
import { validateProfile } from './engine-profile.mjs';
import { diffOf } from './engine-test-run.mjs';

const { profile, problems } = validateProfile(
  JSON.parse(
    readFileSync(
      new URL(
        '../../connectors/pipeline-sandbox/.github/pipeline-profile.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const policy = buildPolicy(profile);
const EXPECTED = '# Sandbox probe\n\nHello from the pilot.\n';
const { expectations } = parseExpectations(
  'Write the probe.\n\n```expected SANDBOX_PROBE.md\n# Sandbox probe\n\nHello from the pilot.\n```\n',
);

/** Patch problems and failing checks for a change that leaves `files`. */
function checkSandboxChange(files, { patch } = {}) {
  const text =
    patch ??
    Object.keys(files)
      .map((path) => diffOf(path))
      .join('');
  const patchCheck = checkPatchPolicy(text, policy);
  const results = runChecks({
    profile,
    changedPaths: patchCheck.paths,
    expectations,
    inspect: (path) => {
      if (!Object.hasOwn(files, path)) return { kind: 'missing' };
      const value = files[path];
      return typeof value === 'string'
        ? { kind: 'file', content: Buffer.from(value) }
        : value;
    },
  });
  return {
    patchProblems: patchCheck.problems,
    failingChecks: results
      .filter((result) => !result.isPassing)
      .map((result) => result.name),
  };
}

const isStopped = (files, options) => {
  const { patchProblems, failingChecks } = checkSandboxChange(files, options);
  return patchProblems.length > 0 || failingChecks.length > 0;
};

test('sandbox profile: documentation only, one writable file, exact content', () => {
  assert.deepEqual(problems, []);
  assert.equal(profile.name, 'pipeline-sandbox');
  assert.deepEqual(profile.paths.writable, ['SANDBOX_PROBE.md']);
  assert.deepEqual(profile.commands, { setup: [], verify: [] });
  assert.deepEqual(profile.agentCommands, []);
  assert.deepEqual(profile.checks, [
    'patch-not-empty',
    'writable-paths',
    'markdown-files',
    'exact-content',
  ]);
  assert.deepEqual(profile.limits, { maxFiles: 1, maxLines: 50 });
});

test('sandbox pilot: the exact expected content in SANDBOX_PROBE.md passes', () => {
  assert.deepEqual(checkSandboxChange({ 'SANDBOX_PROBE.md': EXPECTED }), {
    patchProblems: [],
    failingChecks: [],
  });
});

test('sandbox pilot: valid Markdown that is not the task content is stopped', () => {
  assert.deepEqual(
    checkSandboxChange({ 'SANDBOX_PROBE.md': '# Sandbox probe\n\nHello.\n' }),
    {
      patchProblems: [],
      failingChecks: ['exact-content'],
    },
  );
});

test('sandbox pilot: every other change is stopped', () => {
  for (const path of [
    'README.md',
    'docs/new.md',
    'package.json',
    'pnpm-lock.yaml',
    '.nvmrc',
    'AGENTS.md',
    '.github/workflows/pipeline-plan.yml',
    '.github/pipeline-profile.json',
    'CODEOWNERS',
    'sandbox_probe.md',
  ])
    assert.ok(isStopped({ [path]: EXPECTED }), path);
  assert.ok(isStopped({}), 'an empty change never passes');
  assert.ok(isStopped({ 'SANDBOX_PROBE.md': '<script>alert(1)</script>' }));
  assert.ok(isStopped({ 'SANDBOX_PROBE.md': EXPECTED, 'NOTES.md': '# b\n' }));
});

test('sandbox pilot: SANDBOX_PROBE.md as a symlink to /etc/hostname is stopped twice', () => {
  const link =
    'diff --git a/SANDBOX_PROBE.md b/SANDBOX_PROBE.md\nnew file mode 120000\nindex 0000000..1111111\n--- /dev/null\n+++ b/SANDBOX_PROBE.md\n@@ -0,0 +1 @@\n+/etc/hostname\n';
  const { patchProblems, failingChecks } = checkSandboxChange(
    { 'SANDBOX_PROBE.md': { kind: 'symlink' } },
    { patch: link },
  );
  assert.match(patchProblems.join(), /mode 120000/);
  assert.ok(failingChecks.includes('regular-files'));
});

test('sandbox pilot: a plan outside SANDBOX_PROBE.md does not reach develop', () => {
  const planned = (file) =>
    JSON.stringify({
      status: 'planned',
      problem: 'none',
      questions: [],
      details: [],
      signals: { embedded_instructions: false, needs_secrets_ci_infra: false },
      spec: {
        goal: 'g',
        acceptance_criteria: [{ text: 't', testable: true }],
        rtl_accessibility: 'Not applicable.',
        test_plan: 'exact-content',
        out_of_scope: 'None',
        assumptions: 'None',
      },
      plan: {
        approach: 'a',
        changes: [{ project: 'pipeline-sandbox', file, change: 'c', lines: 2 }],
        tests: 't',
        risks: 'r',
        definition_of_done: 'd',
      },
    });
  const classify = (file) =>
    classifyEnginePlan({ jobResult: 'success', raw: planned(file), policy });
  assert.equal(classify('SANDBOX_PROBE.md').result, 'success');
  for (const file of ['README.md', 'package.json', '.github/workflows/x.yml'])
    assert.equal(classify(file).problem, 'protected_surface', file);
});

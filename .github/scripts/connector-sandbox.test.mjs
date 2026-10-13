// Run: pnpm test:pipeline
// The pipeline-sandbox connector (connectors/pipeline-sandbox): thin event
// adapters pinned to one engine commit, and a documentation-only profile
// that the engine's policy and checks enforce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { runChecks } from './engine-checks.mjs';
import { ENGINE_REPOSITORY, isEngineCommit } from './engine-pin.mjs';
import {
  buildPolicy,
  checkPatchPolicy,
  classifyEnginePlan,
} from './engine-policy.mjs';
import { validateProfile } from './engine-profile.mjs';
import { diffOf } from './engine-test-run.mjs';

const CONNECTOR = new URL(
  '../../connectors/pipeline-sandbox/',
  import.meta.url,
);
const readConnector = (path) => readFileSync(new URL(path, CONNECTOR), 'utf8');
const workflowFiles = readdirSync(
  new URL('.github/workflows/', CONNECTOR),
).sort();
const workflows = Object.fromEntries(
  workflowFiles.map((file) => [
    file,
    parseYaml(readConnector(`.github/workflows/${file}`)),
  ]),
);
const engineCalls = Object.entries(workflows).flatMap(([file, workflow]) =>
  Object.entries(workflow.jobs).map(([name, job]) => ({ file, name, job })),
);
const { profile, problems } = validateProfile(
  JSON.parse(readConnector('.github/pipeline-profile.json')),
);
const policy = buildPolicy(profile);

test('connector: two workflows, issues labeled only, no steps of their own', () => {
  assert.deepEqual(workflowFiles, [
    'pipeline-develop.yml',
    'pipeline-plan.yml',
  ]);
  for (const [file, workflow] of Object.entries(workflows)) {
    assert.deepEqual(
      workflow.on ?? workflow[true],
      { issues: { types: ['labeled'] } },
      file,
    );
    assert.deepEqual(workflow.permissions, {}, file);
    for (const job of Object.values(workflow.jobs))
      assert.equal(job.steps, undefined, `${file}: thin adapter, no steps`);
  }
});

test('connector: every call is pinned to one full engine commit, twice', () => {
  const pins = new Set();
  for (const { file, name, job } of engineCalls) {
    const match =
      /^(.+)\/\.github\/workflows\/(engine-[a-z]+\.yml)@([0-9a-f]+)$/.exec(
        job.uses,
      );
    assert.ok(match, `${file} ${name}: ${job.uses}`);
    const [, repository, , commit] = match;
    assert.equal(repository, ENGINE_REPOSITORY);
    assert.ok(
      isEngineCommit(commit),
      `${file} ${name}: a full commit, not a branch or tag`,
    );
    assert.equal(
      job.with['engine-commit'],
      commit,
      `${file} ${name}: engine-commit = uses`,
    );
    pins.add(commit);
  }
  assert.equal(pins.size, 1, 'one engine commit for every call');
  assert.ok(
    readConnector('README.md').includes([...pins][0]),
    'README names the pin',
  );
  assert.deepEqual(
    engineCalls
      .map(({ job }) => job.uses.replace(/@.*/, '').split('/').pop())
      .sort(),
    ['engine-develop.yml', 'engine-plan.yml', 'engine-publish.yml'],
  );
});

test('connector: label gates, and develop -> publish in one run', () => {
  const plan = workflows['pipeline-plan.yml'].jobs.plan;
  assert.match(plan.if, /github\.event\.label\.name == 'stage:qualified'/);
  const { develop, publish } = workflows['pipeline-develop.yml'].jobs;
  assert.match(develop.if, /github\.event\.label\.name == 'stage:planned'/);
  assert.equal(publish.needs, 'develop');
  assert.match(publish.if, /always\(\) && needs\.develop\.result != 'skipped'/);
  for (const output of [
    'result',
    'prompt_version',
    'request_outcome',
    'patch_rejected',
    'checked',
  ])
    assert.ok(
      Object.values(publish.with).includes(
        `\${{ needs.develop.outputs.${output} }}`,
      ),
      output,
    );
});

test('connector: least privilege per call; the developer gets no write token', () => {
  const byName = Object.fromEntries(
    engineCalls.map(({ name, job }) => [name, job]),
  );
  assert.deepEqual(byName.plan.permissions, {
    contents: 'read',
    issues: 'read',
    'id-token': 'write',
  });
  assert.deepEqual(byName.develop.permissions, {
    contents: 'read',
    issues: 'read',
    'id-token': 'write',
  });
  assert.deepEqual(byName.publish.permissions, {
    contents: 'read',
    'id-token': 'write',
  });
  assert.deepEqual(Object.keys(byName.plan.secrets).sort(), [
    'CLAUDE_CODE_OAUTH_TOKEN',
    'PIPELINE_APP_PRIVATE_KEY',
  ]);
  assert.deepEqual(Object.keys(byName.develop.secrets), [
    'CLAUDE_CODE_OAUTH_TOKEN',
  ]);
  assert.deepEqual(Object.keys(byName.publish.secrets), [
    'PIPELINE_APP_PRIVATE_KEY',
  ]);
  for (const { file, job } of engineCalls) {
    assert.notEqual(job.secrets, 'inherit', file);
    // the target's identity is never passed: the engine reads the context
    for (const input of Object.keys(job.with))
      assert.ok(!/repo|issue|target|number/i.test(input), `${file}: ${input}`);
  }
});

test('sandbox profile: documentation only, one writable file, nothing installed', () => {
  assert.deepEqual(problems, []);
  assert.equal(profile.name, 'pipeline-sandbox');
  assert.deepEqual(profile.paths.writable, ['SANDBOX_PROBE.md']);
  assert.deepEqual(profile.commands, { setup: [], verify: [] });
  assert.deepEqual(profile.agentCommands, []);
  assert.deepEqual(profile.checks, [
    'patch-not-empty',
    'writable-paths',
    'markdown-files',
  ]);
  assert.equal(profile.limits.maxFiles, 1);
});

const checkSandboxChange = (files) => {
  const patch = Object.keys(files)
    .map((path) => diffOf(path))
    .join('');
  const patchCheck = checkPatchPolicy(patch, policy);
  const results = runChecks({
    profile,
    changedPaths: patchCheck.paths,
    readFile: (path) =>
      Object.hasOwn(files, path) ? Buffer.from(files[path]) : null,
  });
  return {
    patchProblems: patchCheck.problems,
    failingChecks: results
      .filter((result) => !result.isPassing)
      .map((result) => result.name),
  };
};

test('sandbox pilot: a Markdown line in SANDBOX_PROBE.md passes every gate', () => {
  assert.deepEqual(
    checkSandboxChange({ 'SANDBOX_PROBE.md': '# Sandbox probe\n\nHello.\n' }),
    {
      patchProblems: [],
      failingChecks: [],
    },
  );
});

test('sandbox pilot: every other change is stopped', () => {
  const stopped = (files) => {
    const { patchProblems, failingChecks } = checkSandboxChange(files);
    return patchProblems.length > 0 || failingChecks.length > 0;
  };
  for (const path of [
    'README.md',
    'docs/new.md',
    'package.json',
    '.github/workflows/pipeline-plan.yml',
    '.github/pipeline-profile.json',
    'CODEOWNERS',
    'sandbox_probe.md',
  ])
    assert.ok(stopped({ [path]: '# x\n' }), path);
  assert.ok(stopped({}), 'an empty change never passes');
  assert.ok(stopped({ 'SANDBOX_PROBE.md': '<script>alert(1)</script>' }));
  assert.ok(stopped({ 'SANDBOX_PROBE.md': '# a\n', 'NOTES.md': '# b\n' }));
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
        test_plan: 'markdown-files',
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

test('connector: each call matches the engine workflow interface', () => {
  for (const { file, name, job } of engineCalls) {
    const engineFile = job.uses.replace(/@.*/, '').split('/').pop();
    const engine = parseYaml(
      readFileSync(
        new URL(`../workflows/${engineFile}`, import.meta.url),
        'utf8',
      ),
    );
    const call = (engine.on ?? engine[true]).workflow_call;
    const where = `${file} ${name} -> ${engineFile}`;
    for (const input of Object.keys(job.with))
      assert.ok(
        Object.hasOwn(call.inputs, input),
        `${where}: unknown input ${input}`,
      );
    for (const [input, spec] of Object.entries(call.inputs))
      if (spec.required)
        assert.ok(Object.hasOwn(job.with, input), `${where}: missing ${input}`);
    assert.deepEqual(
      Object.keys(job.secrets).sort(),
      Object.keys(call.secrets).sort(),
      where,
    );
    if (engineFile === 'engine-develop.yml')
      for (const output of Object.keys(call.outputs))
        assert.ok(
          readConnector('.github/workflows/pipeline-develop.yml').includes(
            `needs.develop.outputs.${output}`,
          ),
          `publish receives ${output}`,
        );
  }
});

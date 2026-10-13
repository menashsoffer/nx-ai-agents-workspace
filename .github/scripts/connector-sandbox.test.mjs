// Run: pnpm test:pipeline
// The pipeline-sandbox connector (connectors/pipeline-sandbox): thin event
// adapters pinned to one engine commit. The profile and the pilot are in
// connector-sandbox-pilot.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ENGINE_REPOSITORY, isEngineCommit } from './engine-pin.mjs';

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
    [
      'engine-check.yml',
      'engine-develop.yml',
      'engine-plan.yml',
      'engine-publish.yml',
    ],
  );
});

test('connector: label gates, and develop -> check -> publish in one run', () => {
  const plan = workflows['pipeline-plan.yml'].jobs.plan;
  assert.match(plan.if, /github\.event\.label\.name == 'stage:qualified'/);
  const { develop, check, publish } = workflows['pipeline-develop.yml'].jobs;
  assert.match(develop.if, /github\.event\.label\.name == 'stage:planned'/);
  assert.equal(check.needs, 'develop');
  assert.match(check.if, /needs\.develop\.result == 'success'/);
  assert.match(check.if, /\.status == 'done'/);
  for (const output of ['base', 'branch', 'result'])
    assert.equal(check.with[output], `\${{ needs.develop.outputs.${output} }}`);
  assert.deepEqual(publish.needs, ['develop', 'check']);
  assert.match(publish.if, /always\(\) && needs\.develop\.result != 'skipped'/);
  // the base publish compares with comes from develop's pin job, and the
  // attestation from the check stage: never from the agent's runner
  assert.equal(publish.with.base, '${{ needs.develop.outputs.base }}');
  assert.equal(
    publish.with.attestation,
    '${{ needs.check.outputs.attestation }}',
  );
  assert.equal(
    publish.with['patch-rejected'],
    '${{ needs.develop.outputs.patch_rejected || needs.check.outputs.patch_rejected }}',
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
  assert.deepEqual(byName.check.permissions, {
    contents: 'read',
    issues: 'read',
    'id-token': 'write',
  });
  assert.equal(byName.check.secrets, undefined);
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
      Object.keys(job.secrets ?? {}).sort(),
      Object.keys(call.secrets ?? {}).sort(),
      where,
    );
    // every output of develop and check reaches a later call
    for (const output of Object.keys(call.outputs ?? {}))
      assert.ok(
        readConnector(`.github/workflows/${file}`).includes(
          `needs.${name}.outputs.${output}`,
        ),
        `${where}: ${output} is passed on`,
      );
  }
});

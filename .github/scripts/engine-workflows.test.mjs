// Run: pnpm test:pipeline
// Structural guards for the engine's reusable workflows (engine-*.yml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ENGINE_REPOSITORY, ENGINE_WORKFLOWS } from './engine-pin.mjs';

const WORKFLOW_DIRECTORY = new URL('../workflows/', import.meta.url);
const readWorkflow = (file) =>
  parseYaml(readFileSync(new URL(file, WORKFLOW_DIRECTORY), 'utf8'));
const engineFiles = readdirSync(WORKFLOW_DIRECTORY)
  .filter((file) => /^engine-.*\.ya?ml$/.test(file))
  .sort();
const workflows = Object.fromEntries(
  engineFiles.map((file) => [file, readWorkflow(file)]),
);
const triggersOf = (workflow) => workflow.on ?? workflow[true];
const jobsOf = (workflow) => Object.entries(workflow.jobs ?? {});
const isAgentStep = (step) =>
  String(step.uses ?? '').startsWith('anthropics/claude-code-action@');
const isAppTokenStep = (step) =>
  String(step.uses ?? '').startsWith('actions/create-github-app-token@');
const isAgentJob = (job) => (job.steps ?? []).some(isAgentStep);
const textOf = (value) => JSON.stringify(value);

test('engine workflows: exactly the ones engine-pin.mjs allows', () => {
  assert.deepEqual(engineFiles, [...ENGINE_WORKFLOWS].sort());
});

test('engine workflows: workflow_call only, no inherited secrets', () => {
  for (const [file, workflow] of Object.entries(workflows)) {
    assert.deepEqual(
      Object.keys(triggersOf(workflow)),
      ['workflow_call'],
      file,
    );
    assert.deepEqual(workflow.permissions, {}, `${file}: permissions: {}`);
    assert.ok(
      !textOf(workflow).includes('inherit'),
      `${file}: no secrets: inherit`,
    );
    const inputs = triggersOf(workflow).workflow_call.inputs;
    assert.equal(inputs['engine-commit'].required, true, file);
    // The target's identity is never an input: it comes from the context.
    for (const name of Object.keys(inputs))
      assert.ok(!/repo|issue|target/i.test(name), `${file}: input ${name}`);
  }
});

test('engine workflows: a pin job first, the only one with id-token', () => {
  for (const [file, workflow] of Object.entries(workflows)) {
    const pin = workflow.jobs.pin;
    assert.equal(pin.permissions['id-token'], 'write', file);
    const pinRun = pin.steps.map((step) => step.run ?? '').join('\n');
    assert.match(
      pinRun,
      new RegExp(`engine\\.mjs pin .*--workflow ${file}`),
      file,
    );
    for (const [name, job] of jobsOf(workflow)) {
      if (name === 'pin') continue;
      assert.ok(
        [].concat(job.needs).includes('pin'),
        `${file} ${name} needs pin`,
      );
      assert.equal(job.permissions?.['id-token'], undefined, `${file} ${name}`);
    }
  }
});

test('engine workflows: two checkouts, the engine pinned and credential-free', () => {
  for (const [file, workflow] of Object.entries(workflows))
    for (const [name, job] of jobsOf(workflow))
      for (const step of job.steps ?? []) {
        if (!String(step.uses ?? '').startsWith('actions/checkout@')) continue;
        assert.equal(
          step.with['persist-credentials'],
          false,
          `${file} ${name}`,
        );
        if (step.with.repository === undefined) continue;
        assert.equal(
          step.with.repository,
          ENGINE_REPOSITORY,
          `${file} ${name}`,
        );
        assert.match(
          step.with.ref,
          /^\$\{\{ (inputs\.engine-commit|needs\.pin\.outputs\.commit) \}\}$/,
          `${file} ${name}: engine ref`,
        );
        assert.equal(step.with.path, '.engine', `${file} ${name}`);
      }
});

test('engine workflows: the developer job holds no write token', () => {
  let agentJobs = 0;
  for (const [file, workflow] of Object.entries(workflows))
    for (const [name, job] of jobsOf(workflow)) {
      if (!isAgentJob(job)) continue;
      agentJobs += 1;
      for (const [scope, level] of Object.entries(job.permissions))
        assert.equal(level, 'read', `${file} ${name}: ${scope}`);
      assert.ok(
        !job.steps.some(isAppTokenStep),
        `${file} ${name}: no App token`,
      );
      const secrets = [...textOf(job).matchAll(/secrets\.(\w+)/g)].map(
        (match) => match[1],
      );
      assert.deepEqual(
        [...new Set(secrets)],
        ['CLAUDE_CODE_OAUTH_TOKEN'],
        file,
      );
      // The request guard runs first and gates the agent.
      const guardIndex = job.steps.findIndex((step) => step.id === 'request');
      const agentIndex = job.steps.findIndex(isAgentStep);
      assert.ok(guardIndex >= 0 && guardIndex < agentIndex, `${file} ${name}`);
      assert.match(
        job.steps[agentIndex].if,
        /steps\.request\.outputs\.is_clean == 'true'/,
      );
    }
  assert.equal(agentJobs, 2);
  const develop = triggersOf(workflows['engine-develop.yml']).workflow_call;
  assert.deepEqual(Object.keys(develop.secrets), ['CLAUDE_CODE_OAUTH_TOKEN']);
});

test('engine-publish: deterministic, and checks before it mints the App token', () => {
  const workflow = workflows['engine-publish.yml'];
  const publish = workflow.jobs.publish;
  assert.ok(!jobsOf(workflow).some(([, job]) => isAgentJob(job)));
  const indexOf = (id) => publish.steps.findIndex((step) => step.id === id);
  const appIndex = publish.steps.findIndex(isAppTokenStep);
  assert.ok(indexOf('manifest') < appIndex && indexOf('guard') < appIndex);
  assert.ok(indexOf('push') > appIndex);
  assert.match(
    publish.steps[indexOf('push')].if,
    /steps\.guard\.outcome == 'success'/,
  );
  assert.match(publish.steps[indexOf('push')].run, /gh pr create .*--draft/);
  for (const [, job] of jobsOf(workflow))
    for (const step of job.steps ?? [])
      if (isAppTokenStep(step))
        assert.equal(step.with['permission-workflows'], undefined);
});

test('engine workflows: per-target concurrency (same issue number, two repositories)', () => {
  for (const [file, workflow] of Object.entries(workflows))
    for (const [name, job] of jobsOf(workflow)) {
      if (!job.concurrency) continue;
      assert.match(
        job.concurrency.group,
        /needs\.pin\.outputs\.repository.*needs\.pin\.outputs\.issue/,
        `${file} ${name}`,
      );
    }
});

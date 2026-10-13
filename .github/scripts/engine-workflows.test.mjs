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
  assert.ok(indexOf('attestation') < appIndex && indexOf('guard') < appIndex);
  assert.match(
    publish.steps[indexOf('push')].run,
    /engine\.mjs" check-tree\n[\s\S]*git push/,
  );
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

const runOf = (step) => step.run ?? '';
const stepIndex = (job, pattern) =>
  job.steps.findIndex((step) => pattern.test(runOf(step)));

test('engine workflows: prompts and tools come from the target profile', () => {
  for (const file of ['engine-plan.yml', 'engine-develop.yml']) {
    const job = Object.values(workflows[file].jobs).find(isAgentJob);
    const profileIndex = stepIndex(job, /engine\.mjs" load-profile/);
    const agentIndex = job.steps.findIndex(isAgentStep);
    assert.ok(profileIndex >= 0 && profileIndex < agentIndex, file);
    assert.match(textOf(job), /prompts\/engine-(plan|develop)\.md/);
    assert.doesNotMatch(textOf(job), /prompts\/(plan|develop)\.md/);
  }
  const develop = workflows['engine-develop.yml'].jobs.implement;
  const agent = develop.steps.find(isAgentStep);
  assert.match(
    agent.with.claude_args,
    /--allowedTools "\$\{\{ steps\.profile\.outputs\.allowed_tools \}\}"/,
  );
  assert.doesNotMatch(agent.with.claude_args, /Bash\(pnpm/);
});

test('engine workflows: every patch check uses the profile policy', () => {
  let checks = 0;
  for (const [file, workflow] of Object.entries(workflows))
    for (const [name, job] of jobsOf(workflow))
      for (const step of job.steps ?? [])
        if (/engine\.mjs" check-patch/.test(runOf(step))) {
          checks += 1;
          assert.match(
            runOf(step),
            /check-patch --profile /,
            `${file} ${name}`,
          );
        }
  assert.equal(checks, 4);
});

test('engine-develop verify job: the policy stops a change before target code runs', () => {
  const { verify } = workflows['engine-develop.yml'].jobs;
  assert.deepEqual(verify.permissions, { contents: 'read' });
  assert.doesNotMatch(textOf(verify), /secrets\./);
  const guard = stepIndex(verify, /check-patch --profile/);
  const profile = stepIndex(verify, /load-profile/);
  assert.ok(profile >= 0 && profile < guard);
  for (const later of [
    /git am/,
    /run-commands --kind setup/,
    /run-commands --kind verify/,
  ])
    assert.ok(stepIndex(verify, later) > guard, String(later));
});

test('engine-develop check job: engine code only, after verify passed', () => {
  const { check } = workflows['engine-develop.yml'].jobs;
  assert.deepEqual(check.needs, ['pin', 'implement', 'verify']);
  assert.equal(check.if, "${{ needs.verify.result == 'success' }}");
  assert.deepEqual(check.permissions, { contents: 'read' });
  assert.doesNotMatch(
    textOf(check),
    /secrets\.|run-commands|setup-node|pnpm |npm /,
  );
  const guard = stepIndex(check, /check-patch --profile/);
  assert.ok(stepIndex(check, /load-profile/) < guard);
  assert.ok(guard < stepIndex(check, /git am/));
  assert.ok(stepIndex(check, /git am/) < stepIndex(check, /run-checks/));
  assert.ok(
    stepIndex(check, /run-checks/) < stepIndex(check, /engine\.mjs" attest/),
  );
});

test('engine-publish: reads the profile but never runs target code', () => {
  const publish = workflows['engine-publish.yml'].jobs.publish;
  assert.doesNotMatch(textOf(publish), /run-commands|run-checks|pnpm |npm /);
  assert.ok(
    stepIndex(publish, /load-profile/) < stepIndex(publish, /check-patch/),
  );
});

test('engine-develop: the base comes from the pin job, never the agent runner', () => {
  const develop = workflows['engine-develop.yml'];
  const pinRun = develop.jobs.pin.steps
    .map((step) => step.run ?? '')
    .join('\n');
  assert.match(pinRun, /--resolve-base/);
  assert.equal(develop.jobs.pin.outputs.base, '${{ steps.pin.outputs.base }}');
  const { implement, check } = develop.jobs;
  const targetCheckout = (job) =>
    job.steps.find(
      (step) =>
        String(step.uses).startsWith('actions/checkout@') &&
        !step.with.repository,
    );
  assert.equal(
    targetCheckout(implement).with.ref,
    '${{ needs.pin.outputs.base }}',
  );
  assert.equal(targetCheckout(check).with.ref, '${{ needs.pin.outputs.base }}');
  // the check job takes nothing from the agent job but its patch artifact
  // and its status; the attestation's base and branch come from pin
  assert.doesNotMatch(textOf(check), /needs\.implement\.outputs\.(?!result)/);
  const attest = check.steps.find((step) => step.id === 'attest');
  assert.equal(attest.env.BASE, '${{ needs.pin.outputs.base }}');
  assert.equal(attest.env.BRANCH, '${{ needs.pin.outputs.branch }}');
  const outputs = triggersOf(develop).workflow_call.outputs;
  assert.equal(outputs.base.value, '${{ jobs.pin.outputs.base }}');
  assert.equal(
    outputs.attestation.value,
    '${{ jobs.check.outputs.attestation }}',
  );
});

test('engine-publish: compares the attestation with the pinned base and the patch', () => {
  const publish = workflows['engine-publish.yml'].jobs.publish;
  const step = publish.steps.find(
    (candidate) => candidate.id === 'attestation',
  );
  assert.equal(step.env.BASE, '${{ inputs.base }}');
  assert.equal(step.env.ATTESTATION, '${{ inputs.attestation }}');
  assert.match(step.run, /check-attestation .*--base "\$BASE" --patch/s);
  const targetCheckout = publish.steps.find(
    (candidate) =>
      String(candidate.uses).startsWith('actions/checkout@') &&
      !candidate.with.repository,
  );
  assert.equal(
    targetCheckout.with.ref,
    '${{ steps.attestation.outputs.base }}',
  );
  assert.ok(
    publish.steps.some((candidate) =>
      /merge-base --is-ancestor/.test(candidate.run ?? ''),
    ),
  );
});

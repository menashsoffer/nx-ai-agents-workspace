// Run: pnpm test:pipeline
// engine-develop.yml -> engine-check.yml -> engine-publish.yml: where the
// base, the patch and the attestation come from, and where target code runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const readWorkflow = (file) =>
  parseYaml(
    readFileSync(new URL(`../workflows/${file}`, import.meta.url), 'utf8'),
  );
const develop = readWorkflow('engine-develop.yml');
const check = readWorkflow('engine-check.yml');
const publish = readWorkflow('engine-publish.yml');
const callOf = (workflow) => (workflow.on ?? workflow[true]).workflow_call;
const textOf = (value) => JSON.stringify(value);
const runOf = (step) => step.run ?? '';
const stepIndex = (job, pattern) =>
  job.steps.findIndex((step) => pattern.test(runOf(step)));
const targetCheckout = (job) =>
  job.steps.find(
    (step) =>
      String(step.uses).startsWith('actions/checkout@') &&
      !step.with.repository,
  );

test('develop: the base comes from the pin job, never the agent runner', () => {
  const pinRun = develop.jobs.pin.steps.map(runOf).join('\n');
  assert.match(pinRun, /--resolve-base/);
  assert.equal(develop.jobs.pin.outputs.base, '${{ steps.pin.outputs.base }}');
  assert.equal(
    targetCheckout(develop.jobs.implement).with.ref,
    '${{ needs.pin.outputs.base }}',
  );
  const outputs = callOf(develop).outputs;
  assert.equal(outputs.base.value, '${{ jobs.pin.outputs.base }}');
  assert.equal(outputs.branch.value, '${{ jobs.pin.outputs.branch }}');
  assert.deepEqual(Object.keys(develop.jobs), ['pin', 'implement']);
});

test('check: no secrets, no agent, and full commits only', () => {
  const call = callOf(check);
  assert.equal(call.secrets, undefined);
  assert.equal(call.inputs.base.required, true);
  assert.doesNotMatch(
    textOf(check),
    /secrets\.|claude-code-action|create-github-app-token/,
  );
  const guardRun = check.jobs.pin.steps.map(runOf).join('\n');
  assert.match(guardRun, /\[\[ "\$BASE" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.equal(
    call.outputs.attestation.value,
    '${{ jobs.check.outputs.attestation }}',
  );
});

test('check verify job: the policy stops a change before target code runs', () => {
  const { verify } = check.jobs;
  assert.deepEqual(verify.permissions, { contents: 'read' });
  assert.equal(targetCheckout(verify).with.ref, '${{ inputs.base }}');
  const guard = stepIndex(verify, /check-patch --profile/);
  assert.ok(stepIndex(verify, /load-profile/) >= 0);
  assert.ok(stepIndex(verify, /load-profile/) < guard);
  const apply = stepIndex(verify, /git am/);
  const lock = stepIndex(verify, /sudo sh -c 'rm -f \/etc\/sudoers\.d\/\*'/);
  const orchestrator = stepIndex(
    verify,
    /engine\.mjs"? verify-target --profile/,
  );
  assert.ok(guard < apply && apply < lock && lock < orchestrator);
  const lockRun = verify.steps[lock].run;
  // node's install folder, the engine and the profile, then every folder
  // above node up to /, become root-owned and not writable by others
  // the engine and the profile are copied to a root-owned folder, and the
  // orchestrator runs from there
  assert.match(
    lockRun,
    /sudo cp -R "\$RUNNER_TEMP\/engine" \/opt\/pipeline-engine\/engine/,
  );
  assert.match(
    lockRun,
    /sudo cp "\$RUNNER_TEMP\/profile\.json" \/opt\/pipeline-engine\/profile\.json/,
  );
  assert.match(
    lockRun,
    /chown -R root:root "\$node_root" \/opt\/pipeline-engine/,
  );
  assert.equal(
    verify.steps[orchestrator].run,
    'node /opt/pipeline-engine/engine/.github/scripts/engine.mjs verify-target --profile /opt/pipeline-engine/profile.json',
  );
  assert.match(
    lockRun,
    /while \[\[ "\$folder" != "\/" \]\]; do\n\s*sudo chown root:root "\$folder"; sudo chmod go-w "\$folder"/,
  );
  // pnpm comes from a root-owned COREPACK_HOME prepared before the lock
  assert.match(
    lockRun,
    /COREPACK_HOME=\/opt\/pipeline-engine\/corepack corepack install/,
  );
  assert.match(
    verify.steps[orchestrator].env.COREPACK_HOME,
    /\/opt\/pipeline-engine\/corepack/,
  );
  // everything that touches the toolchain happens before sudo goes away
  assert.ok(
    lockRun.indexOf('corepack install') <
      lockRun.indexOf('rm -f /etc/sudoers.d/*'),
  );
  assert.match(verify.steps[lock].run, /if sudo -n true .*exit 1/);
  // the orchestrator is the last step, and no other engine process runs
  // after target code could have changed the engine
  assert.equal(orchestrator, verify.steps.length - 1);
  assert.doesNotMatch(textOf(verify), /run-commands/);
});

test('check job: engine code only, after verify passed, then the attestation', () => {
  const job = check.jobs.check;
  assert.deepEqual(job.needs, ['pin', 'verify']);
  assert.equal(job.if, "${{ needs.verify.result == 'success' }}");
  assert.deepEqual(job.permissions, { contents: 'read', issues: 'read' });
  assert.doesNotMatch(textOf(job), /run-commands|setup-node|pnpm |npm /);
  assert.equal(targetCheckout(job).with.ref, '${{ inputs.base }}');
  const guard = stepIndex(job, /check-patch --profile/);
  assert.ok(stepIndex(job, /load-profile/) < guard);
  assert.ok(guard < stepIndex(job, /git am/));
  const checks = stepIndex(job, /run-checks/);
  assert.ok(stepIndex(job, /git am/) < checks);
  assert.match(
    runOf(job.steps[checks]),
    /gh api "repos\/\$GITHUB_REPOSITORY\/issues\/\$N"/,
  );
  assert.match(runOf(job.steps[checks]), /check-output .*--fail=true/s);
  assert.match(runOf(job.steps[checks]), /run-checks .*--issue/s);
  const attest = job.steps.find((step) => step.id === 'attest');
  assert.ok(checks < job.steps.indexOf(attest));
  assert.equal(attest.env.BASE, '${{ inputs.base }}');
  assert.equal(attest.env.BRANCH, '${{ inputs.branch }}');
});

test('publish: attestation, pinned base, patch hash and output scan before the token', () => {
  const job = publish.jobs.publish;
  const indexOf = (id) => job.steps.findIndex((step) => step.id === id);
  const app = indexOf('app');
  for (const id of ['output', 'attestation', 'guard'])
    assert.ok(indexOf(id) < app, id);
  const attestation = job.steps[indexOf('attestation')];
  assert.equal(attestation.env.BASE, '${{ inputs.base }}');
  assert.equal(attestation.env.ATTESTATION, '${{ inputs.attestation }}');
  assert.match(attestation.run, /check-attestation .*--base "\$BASE" --patch/s);
  assert.equal(
    targetCheckout(job).with.ref,
    '${{ steps.attestation.outputs.base }}',
  );
  assert.ok(
    job.steps.some((step) => /merge-base --is-ancestor/.test(runOf(step))),
  );
  const push = job.steps[indexOf('push')];
  assert.match(push.if, /steps\.output\.outputs\.is_clean == 'true'/);
  // the PR title and body are scanned before the branch is pushed
  assert.match(
    push.run,
    /check-text [\s\S]*pr-body\.md"\n[\s\S]*check-commits --base "\$BASE" --fail=true\n[\s\S]*git push/,
  );
  assert.match(push.run, /engine\.mjs" check-tree\n[\s\S]*git push/);
});

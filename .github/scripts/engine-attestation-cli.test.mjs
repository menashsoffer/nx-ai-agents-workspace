// Run: pnpm test:pipeline
// attest (check job) and check-attestation / check-tree (publish job) on a
// real git target: the patch, the base and the tree must all be the ones
// the trusted jobs recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitTarget, runFor } from './engine-test-run.mjs';

const ENGINE_COMMIT = 'a'.repeat(40);
const BRANCH = 'issue-7-probe';

/** The check job: apply the patch to `base` itself, then attest. */
function attestRun() {
  const run = runFor({
    repository: 'menashsoffer/pipeline-sandbox',
    repositoryId: 101,
  });
  const repository = gitTarget(run.directory);
  const { target, base, patch, git } = repository;
  git(target, 'switch', '-q', '--detach', base);
  git(target, 'switch', '-q', '-c', BRANCH);
  git(target, 'am', '-q', '--keep-cr', patch);
  const result = run.runIn(
    target,
    'attest',
    '--stage',
    'develop',
    '--base',
    base,
    '--branch',
    BRANCH,
    '--engine-commit',
    ENGINE_COMMIT,
    '--patch',
    patch,
  );
  assert.equal(result.status, 0, result.stdout);
  return { ...run, ...repository, attestation: run.outputValue('attestation') };
}

/** The publish job's check before it applies anything. */
const checkBeforeApply = (run, { attestation, base, patch }) =>
  run.runWith(
    { environment: { ATTESTATION: attestation } },
    'check-attestation',
    '--stage',
    'publish',
    '--engine-commit',
    ENGINE_COMMIT,
    '--base',
    base,
    '--patch',
    patch,
  );

test('attest -> check-attestation -> check-tree: the honest path holds', () => {
  const run = attestRun();
  const parsed = JSON.parse(run.attestation);
  assert.equal(parsed.base, run.base);
  assert.equal(parsed.verification, 'passed');
  const checked = checkBeforeApply(run, run);
  assert.equal(checked.status, 0, checked.stdout);
  assert.equal(run.outputValue('branch'), BRANCH);
  // publish applies the same patch to the same base: same tree
  const publish = join(run.directory, 'publish');
  run.git(run.directory, 'clone', '-q', run.target, publish);
  run.git(publish, 'switch', '-q', '--detach', run.base);
  run.git(publish, 'am', '-q', '--keep-cr', run.patch);
  const tree = run.runWith(
    { cwd: publish, environment: { ATTESTATION: run.attestation } },
    'check-tree',
  );
  assert.equal(tree.status, 0, tree.stdout);
});

test('tamper: an old base fails even with a matching patch', () => {
  const run = attestRun();
  const result = checkBeforeApply(run, { ...run, base: run.oldBase });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /its base is not the base the pin job recorded/);
  // and an attestation rewritten to the old base fails against the pinned one
  const rewritten = JSON.stringify({
    ...JSON.parse(run.attestation),
    base: run.oldBase,
  });
  const forged = checkBeforeApply(run, { ...run, attestation: rewritten });
  assert.equal(forged.status, 1);
});

test('tamper: a patch replaced after the check fails', () => {
  const run = attestRun();
  appendFileSync(run.patch, '\n');
  const result = checkBeforeApply(run, run);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /the patch is not the one that was checked/);
});

test('tamper: a forged attestation fails', () => {
  const run = attestRun();
  const good = JSON.parse(run.attestation);
  for (const [forgery, message] of [
    [{ ...good, verification: 'failed' }, /verification did not pass/],
    [{ ...good, repository: 'someone/else' }, /another repository/],
    [{ ...good, engine_commit: 'f'.repeat(40) }, /another engine commit/],
    [{ ...good, approved: true }, /unknown fields: approved/],
  ]) {
    const result = checkBeforeApply(run, {
      ...run,
      attestation: JSON.stringify(forgery),
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, message);
  }
  const broken = checkBeforeApply(run, { ...run, attestation: '{not json' });
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /the attestation is missing/);
});

test('tamper: another tree after applying fails check-tree', () => {
  const run = attestRun();
  const publish = join(run.directory, 'publish');
  run.git(run.directory, 'clone', '-q', run.target, publish);
  run.git(publish, 'switch', '-q', '--detach', run.base);
  mkdirSync(join(publish, 'docs'));
  writeFileSync(join(publish, 'docs/extra.md'), 'smuggled\n');
  run.git(publish, 'add', '-A');
  run.git(publish, 'commit', '-q', '-m', 'extra');
  run.git(publish, 'am', '-q', '--keep-cr', run.patch);
  const result = run.runWith(
    { cwd: publish, environment: { ATTESTATION: run.attestation } },
    'check-tree',
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /another tree than the attested one/);
});

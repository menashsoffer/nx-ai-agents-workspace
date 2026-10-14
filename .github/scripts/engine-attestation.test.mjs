// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttestation,
  checkAttestation,
  sha256Of,
  treeProblems,
} from './engine-attestation.mjs';

const ENGINE_COMMIT = 'a'.repeat(40);
const PINNED_BASE = 'b'.repeat(40);
const OLD_BASE = 'c'.repeat(40);
const TREE = 'd'.repeat(40);
const PATCH = 'diff --git a/SANDBOX_PROBE.md b/SANDBOX_PROBE.md\n';

const sandbox = {
  repository: 'menashsoffer/pipeline-sandbox',
  repositoryId: '101',
  issue: 7,
};
const workspace = {
  repository: 'menashsoffer/nx-ai-agents-workspace',
  repositoryId: '202',
  issue: 7,
};

const attest = (overrides = {}) =>
  buildAttestation({
    target: sandbox,
    base: PINNED_BASE,
    branch: 'issue-7-probe',
    engineCommit: ENGINE_COMMIT,
    patchSha256: sha256Of(PATCH),
    tree: TREE,
    ...overrides,
  });

const check = (attestation, overrides = {}) =>
  checkAttestation(attestation, {
    target: sandbox,
    engineCommit: ENGINE_COMMIT,
    base: PINNED_BASE,
    patchSha256: sha256Of(PATCH),
    ...overrides,
  });

test('an attestation from this run holds', () => {
  assert.deepEqual(check(attest()), []);
  assert.deepEqual(treeProblems(attest(), TREE), []);
});

test('tamper: an older base than the one the pin job recorded fails', () => {
  assert.deepEqual(check(attest({ base: OLD_BASE })), [
    'its base is not the base the pin job recorded',
  ]);
  // the base the pin job passed must itself be a commit
  assert.deepEqual(check(attest(), { base: 'main' }), [
    'the pinned base is not a commit',
  ]);
});

test('tamper: a replaced patch fails, by hash and by tree', () => {
  assert.deepEqual(
    check(attest(), { patchSha256: sha256Of(`${PATCH}+evil\n`) }),
    ['the patch is not the one that was checked'],
  );
  assert.deepEqual(treeProblems(attest(), 'e'.repeat(40)), [
    'applying the patch gave another tree than the attested one',
  ]);
});

test('tamper: a forged attestation fails', () => {
  const good = attest();
  assert.deepEqual(check({ ...good, verification: 'failed' }), [
    'its verification did not pass',
  ]);
  assert.deepEqual(check({ ...good, engine_commit: 'f'.repeat(40) }), [
    'it was built by another engine commit',
  ]);
  assert.deepEqual(check({ ...good, issue: 8 }), ['it names another issue']);
  assert.deepEqual(check({ ...good, branch: 'issue-8-probe' }), [
    'its branch is not the branch of this issue',
  ]);
  assert.deepEqual(check({ ...good, signed_by: 'me' }), [
    'unknown fields: signed_by',
  ]);
  const { tree, ...withoutTree } = good;
  assert.equal(tree, TREE);
  assert.deepEqual(check(withoutTree), [
    'missing fields: tree',
    'its tree is not a git object id',
  ]);
  assert.deepEqual(check({ ...good, schema: 2 }), ['unknown schema']);
  assert.deepEqual(check(null), ['the attestation is missing']);
  assert.deepEqual(check('{"schema":1}'), ['the attestation is missing']);
});

test('same issue number in two repositories: attestations do not cross', () => {
  assert.deepEqual(check(attest(), { target: workspace }), [
    'it names another repository',
    'it names another repository id',
  ]);
});

test('buildAttestation: only well-formed values from trusted jobs', () => {
  assert.throws(() => attest({ base: 'main' }), /Bad base/);
  assert.throws(() => attest({ engineCommit: 'v1' }), /Bad engine commit/);
  assert.throws(() => attest({ tree: '' }), /Bad tree/);
  assert.throws(() => attest({ patchSha256: 'x' }), /Bad patch hash/);
  assert.throws(() => attest({ branch: 'issue-70-x' }), /Bad branch/);
  assert.equal(attest().verification, 'passed');
});

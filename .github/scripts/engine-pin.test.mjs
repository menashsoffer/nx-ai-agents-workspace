// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_REPOSITORY,
  checkPin,
  decodeClaims,
  isEngineCommit,
} from './engine-pin.mjs';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const claimsFor = ({
  workflow = 'engine-develop.yml',
  reference = COMMIT,
  sha = COMMIT,
  repository = 'menashsoffer/pipeline-sandbox',
} = {}) => ({
  job_workflow_ref: `${ENGINE_REPOSITORY}/.github/workflows/${workflow}@${reference}`,
  job_workflow_sha: sha,
  repository,
});
const pin = (claims, overrides = {}) =>
  checkPin({
    claims,
    engineCommit: COMMIT,
    workflow: 'engine-develop.yml',
    repository: 'menashsoffer/pipeline-sandbox',
    checkedOut: COMMIT,
    ...overrides,
  });

test('checkPin: an exact commit pin for the right caller passes', () => {
  assert.deepEqual(pin(claimsFor()), []);
});

test('checkPin: a branch or tag reference is not a pin', () => {
  assert.deepEqual(pin(claimsFor({ reference: 'refs/heads/main' })), [
    'the engine workflow was not called by this exact commit (a branch, a tag or another file)',
  ]);
  assert.deepEqual(pin(claimsFor({ reference: 'refs/tags/v1' })).length, 1);
});

test('checkPin: engine-commit must match what GitHub ran and what is checked out', () => {
  const other = 'f'.repeat(40);
  assert.deepEqual(pin(claimsFor({ sha: other, reference: other })), [
    'GitHub ran another engine commit than engine-commit',
    'the engine workflow was not called by this exact commit (a branch, a tag or another file)',
  ]);
  assert.deepEqual(pin(claimsFor(), { checkedOut: other }), [
    'the checked-out engine is not engine-commit',
  ]);
});

test('checkPin: wrong caller identity or wrong workflow fails', () => {
  assert.deepEqual(pin(claimsFor({ repository: 'someone/else' })), [
    'the OIDC caller repository differs from GITHUB_REPOSITORY',
  ]);
  assert.equal(pin(claimsFor({ workflow: 'engine-plan.yml' })).length, 1);
  assert.deepEqual(pin(claimsFor(), { workflow: 'ci.yml' }), [
    'ci.yml is not an engine workflow',
  ]);
  assert.deepEqual(pin(claimsFor(), { engineCommit: 'main' }), [
    'engine-commit is not a full 40-character commit',
  ]);
  assert.ok(pin(null).length >= 2);
});

test('decodeClaims and isEngineCommit', () => {
  const payload = Buffer.from(JSON.stringify({ repository: 'a/b' })).toString(
    'base64url',
  );
  assert.deepEqual(decodeClaims(`x.${payload}.y`), { repository: 'a/b' });
  assert.throws(() => decodeClaims('not-a-token'), /not a JWT/);
  assert.equal(isEngineCommit(COMMIT), true);
  assert.equal(isEngineCommit(COMMIT.toUpperCase()), false);
  assert.equal(isEngineCommit('abc123'), false);
});

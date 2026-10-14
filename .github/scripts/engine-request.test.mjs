// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECRET_KINDS,
  requestOutcome,
  scanRequest,
  secretKinds,
} from './engine-request.mjs';

// Built at runtime so no secret-shaped literal sits in the repository.
const repeat = (character, count) => character.repeat(count);
const SAMPLES = {
  github_token: `ghp_${repeat('A', 36)}`,
  anthropic_key: `sk-ant-api03-${repeat('b', 30)}`,
  aws_access_key: `AKIA${repeat('Q', 16)}`,
  private_key: ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
};

const cleanRequest = () => ({
  number: 7,
  title: 'Add a probe line',
  body: 'Write one line to SANDBOX_PROBE.md. The ghp_ prefix is just text.',
  spec: null,
  plan: null,
  comments: [{ author: 'owner', body: 'Use the word sk-ant in prose only.' }],
});

test('scanRequest: an ordinary request is clean', () => {
  assert.deepEqual(scanRequest(cleanRequest()), {
    isClean: true,
    findings: [],
  });
  assert.equal(scanRequest(null).isClean, true);
});

test('secretKinds: each credential shape is found', () => {
  for (const [kind, sample] of Object.entries(SAMPLES))
    assert.deepEqual(secretKinds(`see ${sample} here`), [kind], kind);
});

test('scanRequest: a secret in the request stops it, naming field and kind only', () => {
  const request = cleanRequest();
  request.body += `\ntoken: ${SAMPLES.github_token}`;
  request.comments.push({ author: 'x', body: SAMPLES.anthropic_key });
  const { isClean, findings } = scanRequest(request);
  assert.equal(isClean, false);
  assert.deepEqual(findings, [
    { field: 'body', kinds: ['github_token'] },
    { field: 'comments[1].body', kinds: ['anthropic_key'] },
  ]);
  const outcome = requestOutcome('plan', findings);
  assert.equal(outcome.problem, 'needs_secrets_ci_infra');
  const text = JSON.stringify(outcome);
  assert.ok(!text.includes(SAMPLES.github_token));
  assert.ok(!text.includes(SAMPLES.anthropic_key));
  assert.match(text, /secret_in_request: body \(github_token\)/);
});

test('scanRequest: the spec and plan fields are scanned too', () => {
  const request = { ...cleanRequest(), plan: `key ${SAMPLES.aws_access_key}` };
  assert.deepEqual(scanRequest(request).findings, [
    { field: 'plan', kinds: ['aws_access_key'] },
  ]);
});

test('SECRET_KINDS lists every kind once', () => {
  assert.equal(new Set(SECRET_KINDS).size, SECRET_KINDS.length);
  for (const [kind] of Object.entries(SAMPLES))
    assert.ok(SECRET_KINDS.includes(kind), kind);
});

// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  outputOutcome,
  requestOutcome,
  scanOutput,
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

test('scanOutput: the agent JSON, the added patch lines and named texts', () => {
  const token = SAMPLES.github_token;
  assert.deepEqual(
    scanOutput({ result: '{"pr_body":"fine"}', patch: '+ok\n' }),
    {
      isClean: true,
      findings: [],
    },
  );
  const { findings } = scanOutput({
    result: JSON.stringify({
      pr_body: token,
      details: ['x', SAMPLES.aws_access_key],
    }),
    patch: `--- a/x\n+++ b/x\n-${SAMPLES.anthropic_key}\n+${token}\n`,
    texts: { 'pr-body.md': SAMPLES.private_key },
  });
  assert.deepEqual(findings, [
    { field: 'result.pr_body', kinds: ['github_token'] },
    { field: 'result.details[1]', kinds: ['aws_access_key'] },
    { field: 'patch', kinds: ['github_token'] },
    { field: 'pr-body.md', kinds: ['private_key'] },
  ]);
  // a removed line is not new output, and unparsable JSON is scanned as text
  assert.equal(scanOutput({ patch: `-${token}\n` }).isClean, true);
  assert.equal(
    scanOutput({ result: `not json ${token}` }).findings[0].field,
    'result',
  );
  const outcome = outputOutcome('develop', findings);
  assert.equal(outcome.problem, 'needs_secrets_ci_infra');
  assert.ok(!JSON.stringify(outcome).includes(token));
});

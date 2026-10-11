// Run with: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeAgentFailure } from './agent-failure-summary.mjs';

const SECRET = 'SECRET-TRANSCRIPT-TEXT';

const transcriptMessages = [
  { type: 'system', subtype: 'init', model: 'm', cwd: SECRET },
  { type: 'assistant', message: { content: [{ type: 'text', text: SECRET }] } },
  {
    type: 'user',
    message: { content: [{ type: 'tool_result', content: SECRET }] },
  },
];

const errorResult = {
  type: 'result',
  subtype: 'error_max_structured_output_retries',
  is_error: true,
  duration_ms: 1234,
  num_turns: 7,
  stop_reason: 'end_turn',
  terminal_reason: 'structured_output_retry_exhausted',
  errors: ['Failed to provide valid structured output after 5 attempts'],
};

test('fields outside the allowlist are never emitted', () => {
  const messages = [
    ...transcriptMessages,
    {
      ...errorResult,
      session_id: 'session-id',
      uuid: 'uuid',
      total_cost_usd: 1.5,
      usage: { input_tokens: 1 },
      modelUsage: { m: { costUSD: 1 } },
      permission_denials: [
        { tool_name: 'Bash', tool_input: { command: SECRET } },
      ],
      structured_output: { pr_body: SECRET },
    },
  ];
  const summary = summarizeAgentFailure(JSON.stringify(messages));
  assert.deepEqual(summary, {
    subtype: 'error_max_structured_output_retries',
    stop_reason: 'end_turn',
    terminal_reason: 'structured_output_retry_exhausted',
    is_error: true,
    duration_ms: 1234,
    num_turns: 7,
    error_count: 1,
  });
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(SECRET));
});

test('only the last result message is summarized', () => {
  const messages = [
    { ...errorResult, subtype: 'error_during_execution', num_turns: 1 },
    { ...errorResult, num_turns: 9 },
  ];
  const summary = summarizeAgentFailure(messages);
  assert.equal(summary.subtype, 'error_max_structured_output_retries');
  assert.equal(summary.num_turns, 9);
});

test('free prose in result and errors[] is never emitted', () => {
  const prose = `customer ${SECRET} asked for a refund`;
  const summary = summarizeAgentFailure([
    {
      ...errorResult,
      is_error: true,
      result: prose,
      errors: [prose, { text: prose }, 42],
    },
  ]);
  assert.equal(summary.result, undefined);
  assert.equal(summary.errors, undefined);
  assert.equal(summary.error_count, 3);
  assert.doesNotMatch(JSON.stringify(summary), /customer|refund/);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(SECRET));
});

test('a registered secret never passes through the enum fields', () => {
  const REGISTERED_SECRET = 'private_customer_identifier';
  const summary = summarizeAgentFailure([
    {
      ...errorResult,
      subtype: REGISTERED_SECRET,
      stop_reason: REGISTERED_SECRET,
      terminal_reason: REGISTERED_SECRET,
      api_error_status: REGISTERED_SECRET,
    },
  ]);
  assert.equal(summary.subtype, '[unrecognized]');
  assert.equal(summary.stop_reason, '[unrecognized]');
  assert.equal(summary.terminal_reason, '[unrecognized]');
  assert.equal(summary.api_error_status, undefined);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(REGISTERED_SECRET));
});

test('known enum values and status codes are kept', () => {
  const summary = summarizeAgentFailure([
    { ...errorResult, subtype: 'error_max_turns', api_error_status: 529 },
  ]);
  assert.equal(summary.subtype, 'error_max_turns');
  assert.equal(summary.api_error_status, 529);
});

test('input with no result message does not throw', () => {
  const note = { note: 'no SDK result message found in the execution file' };
  assert.deepEqual(
    summarizeAgentFailure(JSON.stringify(transcriptMessages)),
    note,
  );
  assert.deepEqual(summarizeAgentFailure('[]'), note);
  assert.deepEqual(summarizeAgentFailure('not json'), note);
  assert.deepEqual(summarizeAgentFailure(''), note);
  assert.deepEqual(summarizeAgentFailure('{"type":"result"}'), note);
  assert.deepEqual(summarizeAgentFailure(undefined), note);
  assert.deepEqual(summarizeAgentFailure(null), note);
  assert.deepEqual(summarizeAgentFailure([null, 7, 'x']), note);
});

test('the command line prints only the summary line and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-failure-'));
  const file = join(dir, 'claude-execution-output.json');
  writeFileSync(
    file,
    JSON.stringify([
      ...transcriptMessages,
      { ...errorResult, result: SECRET, errors: [SECRET], stop_reason: SECRET },
    ]),
  );
  const script = new URL('./agent-failure-summary.mjs', import.meta.url)
    .pathname;

  const output = execFileSync('node', [script, file], { encoding: 'utf8' });
  assert.match(output, /^Agent failure summary: \{.*\}\n$/);
  assert.ok(output.includes('error_max_structured_output_retries'));
  assert.ok(!output.includes(SECRET));

  const missing = execFileSync('node', [script, join(dir, 'absent.json')], {
    encoding: 'utf8',
  });
  assert.match(missing, /no execution file was produced/);
  const unset = execFileSync('node', [script], { encoding: 'utf8' });
  assert.match(unset, /no execution file was produced/);
});

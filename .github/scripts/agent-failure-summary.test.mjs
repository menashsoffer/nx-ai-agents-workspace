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
    is_error: true,
    duration_ms: 1234,
    num_turns: 7,
    stop_reason: 'end_turn',
    terminal_reason: 'structured_output_retry_exhausted',
    errors: ['Failed to provide valid structured output after 5 attempts'],
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

test('result text is emitted only when is_error is true', () => {
  const success = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: SECRET,
  };
  assert.equal(summarizeAgentFailure([success]).result, undefined);
  const apiError = { ...success, is_error: true, result: 'API Error: 529' };
  assert.equal(summarizeAgentFailure([apiError]).result, 'API Error: 529');
});

test('long strings are truncated to 300 characters', () => {
  const long = 'x'.repeat(5000);
  const summary = summarizeAgentFailure([
    {
      ...errorResult,
      errors: [long, long],
      stop_reason: long,
      is_error: true,
      result: long,
    },
  ]);
  for (const text of [summary.stop_reason, summary.result, ...summary.errors]) {
    assert.ok(text.length <= 301, `${text.length} chars`);
    assert.ok(text.startsWith('x'.repeat(300)));
  }
});

test('the number of error entries is capped and non-strings are dropped', () => {
  const errors = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.equal(
    summarizeAgentFailure([{ ...errorResult, errors }]).errors.length,
    5,
  );
  const mixed = [{ ...errorResult, errors: ['ok', { text: SECRET }, 42] }];
  assert.deepEqual(summarizeAgentFailure(mixed).errors, ['ok']);
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
  writeFileSync(file, JSON.stringify([...transcriptMessages, errorResult]));
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

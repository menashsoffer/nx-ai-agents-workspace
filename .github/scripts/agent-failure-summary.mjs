// Diagnosis for failed agent steps (issue #120): prints an allowlisted summary
// of the last SDK result from the execution file that claude-code-action writes.
//
// The execution file is a JSON array of every SDK message of the run
// (base-action/src/execution-file.ts), including the transcript, tool calls and
// tool output. None of that may reach the job log, so only the fields below are
// copied out of the final `type: "result"` message. Field names come from
// SDKResultSuccess / SDKResultError in @anthropic-ai/claude-agent-sdk 0.3.x.
//
// Run by develop.yml: node .github/scripts/agent-failure-summary.mjs "$EXECUTION_FILE"
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UNRECOGNIZED = '[unrecognized]';

// The job log is public, so only typed metadata, known categories and status
// codes are copied. Free prose (`result`, the text of `errors[]`) can echo
// anything the model or an API saw, so it is never copied; `errors[]` is
// reduced to a count.
//
// Enum fields are matched against these allowlists of known values. Anything
// else (a new SDK value, or text that is not an enum at all) is replaced by a
// generic placeholder instead of being copied.
const ENUM_ALLOWLISTS = {
  subtype: [
    'success',
    'error_during_execution',
    'error_max_turns',
    'error_max_budget_usd',
    'error_max_structured_output_retries',
  ],
  stop_reason: [
    'end_turn',
    'max_tokens',
    'stop_sequence',
    'tool_use',
    'pause_turn',
    'refusal',
  ],
  terminal_reason: [
    'completed',
    'max_turns',
    'aborted_streaming',
    'aborted_tools',
    'prompt_too_long',
    'model_error',
    'blocking_limit',
    'structured_output_retry_exhausted',
  ],
};

// Copied only when they are numbers or booleans (never strings).
const TYPED_FIELDS = [
  'is_error',
  'duration_ms',
  'num_turns',
  'api_error_status',
];

function toKnownEnumValue(field, value) {
  if (typeof value !== 'string') return undefined;
  return ENUM_ALLOWLISTS[field].includes(value) ? value : UNRECOGNIZED;
}

function toTypedValue(value) {
  return typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

function parseMessages(executionFileJson) {
  if (typeof executionFileJson !== 'string') return executionFileJson;
  try {
    return JSON.parse(executionFileJson);
  } catch {
    return undefined;
  }
}

function findLastResult(messages) {
  if (!Array.isArray(messages)) return undefined;
  return messages.findLast(
    (message) =>
      message !== null &&
      typeof message === 'object' &&
      message.type === 'result',
  );
}

/**
 * @param {string | unknown[]} executionFileJson the execution file, raw or parsed
 * @returns {Record<string, unknown>} allowlisted fields of the last SDK result,
 *   or `{ note }` when there is none. Never throws.
 */
export function summarizeAgentFailure(executionFileJson) {
  const lastResult = findLastResult(parseMessages(executionFileJson));
  if (!lastResult) {
    return { note: 'no SDK result message found in the execution file' };
  }

  const summary = {};
  for (const field of Object.keys(ENUM_ALLOWLISTS)) {
    const value = toKnownEnumValue(field, lastResult[field]);
    if (value !== undefined) summary[field] = value;
  }
  for (const field of TYPED_FIELDS) {
    const value = toTypedValue(lastResult[field]);
    if (value !== undefined) summary[field] = value;
  }
  if (Array.isArray(lastResult.errors)) {
    summary.error_count = lastResult.errors.length;
  }

  return summary;
}

function readExecutionFile(executionFilePath) {
  if (!executionFilePath) return undefined;
  try {
    return readFileSync(executionFilePath, 'utf8');
  } catch {
    return undefined;
  }
}

// Diagnosis must never fail the job: always exit 0 and print only the summary.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const executionFileJson = readExecutionFile(process.argv[2]);
  const summary =
    executionFileJson === undefined
      ? { note: 'no execution file was produced' }
      : summarizeAgentFailure(executionFileJson);
  console.log(`Agent failure summary: ${JSON.stringify(summary)}`);
}

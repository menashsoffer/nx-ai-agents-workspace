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

const MAX_FIELD_LENGTH = 300;
const MAX_ERROR_COUNT = 5;

// Copied as-is (numbers, booleans) or truncated (strings).
const SCALAR_FIELDS = [
  'subtype',
  'is_error',
  'duration_ms',
  'num_turns',
  'stop_reason',
  'terminal_reason',
  'api_error_status',
];

function truncate(text) {
  return text.length > MAX_FIELD_LENGTH
    ? `${text.slice(0, MAX_FIELD_LENGTH)}…`
    : text;
}

function toSafeScalar(value) {
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
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
  for (const field of SCALAR_FIELDS) {
    const value = toSafeScalar(lastResult[field]);
    if (value !== undefined) summary[field] = value;
  }

  // `errors` is set on the error subtypes (error_max_structured_output_retries, ...).
  if (Array.isArray(lastResult.errors)) {
    summary.errors = lastResult.errors
      .slice(0, MAX_ERROR_COUNT)
      .filter((entry) => typeof entry === 'string')
      .map(truncate);
  }

  // `result` is the final assistant text on a normal success, so it is only
  // error text (a failed API call) when is_error is true.
  if (lastResult.is_error === true && typeof lastResult.result === 'string') {
    summary.result = truncate(lastResult.result);
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

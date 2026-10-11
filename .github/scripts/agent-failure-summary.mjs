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
const MIN_SECRET_LENGTH = 8;
const REDACTED = '[REDACTED]';

// Copied as-is (numbers, booleans). Strings must look like an SDK identifier
// (`end_turn`, `error_max_turns`): these fields are enums, never free text, so
// anything else is replaced instead of copied.
const SCALAR_FIELDS = [
  'subtype',
  'is_error',
  'duration_ms',
  'num_turns',
  'stop_reason',
  'terminal_reason',
  'api_error_status',
];
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const INVALID_IDENTIFIER = '[not an identifier]';

// Free text (`result`, `errors[]`) can echo whatever the model or an API saw,
// so known token shapes are masked on top of the exact values passed in.
const SECRET_SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

function redactSecrets(text, secrets) {
  let redacted = text;
  for (const secret of secrets)
    redacted = redacted.replaceAll(secret, REDACTED);
  for (const shape of SECRET_SHAPES)
    redacted = redacted.replace(shape, REDACTED);
  return redacted;
}

function truncate(text) {
  return text.length > MAX_FIELD_LENGTH
    ? `${text.slice(0, MAX_FIELD_LENGTH)}…`
    : text;
}

// Redact before truncating so a secret cut in half is not left readable.
function toSafeText(text, secrets) {
  return truncate(redactSecrets(text, secrets));
}

function toSafeScalar(value) {
  if (typeof value === 'string') {
    return IDENTIFIER_PATTERN.test(value) ? value : INVALID_IDENTIFIER;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

/** Values of secret-looking environment variables, for the command line. */
function collectEnvironmentSecrets(environment) {
  return Object.entries(environment)
    .filter(([name]) => /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i.test(name))
    .map(([, value]) => value)
    .filter((value) => typeof value === 'string');
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
 * @param {{ secrets?: string[] }} [options] exact values to mask in free text
 * @returns {Record<string, unknown>} allowlisted fields of the last SDK result,
 *   or `{ note }` when there is none. Never throws.
 */
export function summarizeAgentFailure(executionFileJson, options = {}) {
  const secrets = (options.secrets ?? []).filter(
    (secret) =>
      typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH,
  );
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
      .map((entry) => toSafeText(entry, secrets));
  }

  // `result` is the final assistant text on a normal success, so it is only
  // error text (a failed API call) when is_error is true.
  if (lastResult.is_error === true && typeof lastResult.result === 'string') {
    summary.result = toSafeText(lastResult.result, secrets);
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
      : summarizeAgentFailure(executionFileJson, {
          secrets: collectEnvironmentSecrets(process.env),
        });
  console.log(`Agent failure summary: ${JSON.stringify(summary)}`);
}

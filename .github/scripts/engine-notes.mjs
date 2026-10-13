// Notes the engine's publish steps post, built only from closed sets.
//
// Values that crossed from the agent's runner (the request findings, the
// developer's JSON, a prompt version) are never posted as they are: each
// one is checked against an enum or a strict format, anything else is
// replaced by a fixed text, and the rendered note is scanned for secrets
// once more before it is written for posting. The prompt version comes from
// the engine checkout at the pinned commit, not from the agent's job.
//
// Pure: no I/O.
import {
  normalizeOutcome,
  promptVersion,
  renderOutcome,
} from './pipeline-lib.mjs';
import {
  SECRET_KINDS,
  requestOutcome,
  secretKinds,
} from './engine-request.mjs';

const JOB_RESULTS = ['success', 'failure', 'cancelled', 'skipped'];
/** Problems the developer may report (its --json-schema enum). */
const DEVELOP_PROBLEMS = [
  'verify_failed',
  'plan_gap',
  'protected_surface',
  'needs_secrets_ci_infra',
  'agent_error',
];
/** Request fields scanRequest reports. */
const REQUEST_FIELD = /^(?:title|body|spec|plan|comments\[\d{1,4}\]\.body)$/;
const MAX_FINDINGS = 50;

/** `field:kind,...`: the only form request findings leave the agent's job in. */
export const encodeFindings = (findings) =>
  findings
    .flatMap(({ field, kinds }) => kinds.map((kind) => `${field}:${kind}`))
    .join(',');

/** The findings, or null when any entry is not a known field and kind. */
export function decodeFindings(text) {
  const entries = String(text ?? '').split(',');
  if (!text || entries.length > MAX_FINDINGS) return null;
  const findings = [];
  for (const entry of entries) {
    const separator = entry.lastIndexOf(':');
    const field = entry.slice(0, separator);
    const kind = entry.slice(separator + 1);
    if (!REQUEST_FIELD.test(field) || !SECRET_KINDS.includes(kind)) return null;
    const existing = findings.find((finding) => finding.field === field);
    if (existing) existing.kinds.push(kind);
    else findings.push({ field, kinds: [kind] });
  }
  return findings;
}

/** The request note: from validated findings, or a fixed note without them. */
export function requestNote(stage, findingsText) {
  const findings = decodeFindings(findingsText);
  if (findings) return requestOutcome(stage, findings);
  return {
    ...requestOutcome(stage, []),
    details: [
      'secret_in_request: details withheld (the findings did not validate)',
    ],
  };
}

const jobResult = (value) => (JOB_RESULTS.includes(value) ? value : 'failure');

/**
 * The develop problem note. The developer's own words (blocked_reason,
 * pr_title, an unknown problem code) are never part of it.
 */
export function developNote({
  implementResult,
  publishResult,
  raw,
  patchRejected,
}) {
  if (patchRejected)
    return {
      stage: 'develop',
      result: 'problem',
      problem: 'forbidden_path',
      details: [
        'The patch was rejected: it touches protected paths or breaks the policy.',
      ],
    };
  let status;
  let problem;
  try {
    ({ status, problem } = JSON.parse(raw));
  } catch {
    status = undefined;
  }
  if (status === 'blocked')
    return {
      stage: 'develop',
      result: 'problem',
      problem: DEVELOP_PROBLEMS.includes(problem) ? problem : 'agent_error',
      details: [
        'The developer stopped. Its own reason is not posted (agent text); see the run.',
      ],
    };
  return {
    stage: 'develop',
    result: 'problem',
    problem: 'agent_error',
    details: [
      `Implement job: ${jobResult(implementResult)}; publish job: ${jobResult(publishResult)}.`,
    ],
  };
}

/** The success note after publish opened draft PR `pullRequest`. */
export function publishedNote(pullRequest) {
  const number = Number(pullRequest);
  if (!Number.isInteger(number) || number <= 0)
    throw new Error('Bad PR number');
  return {
    stage: 'develop',
    result: 'success',
    summary: `Draft PR #${number} opened.`,
  };
}

/** `<name>@<version>` from the engine's own prompt file. */
export function enginePromptVersion(name, promptText) {
  const version = promptVersion(promptText);
  return /^[\w.-]{1,20}$/.test(version)
    ? `${name}@${version}`
    : `${name}@unknown`;
}

/**
 * Normalizes, renders and scans a note. Returns the outcome to write for
 * posting; throws when the rendered note holds a secret-shaped value.
 */
export function safeNote(outcome, { promptVersionText, runUrl = '' }) {
  const note = normalizeOutcome({
    ...outcome,
    prompt_version: promptVersionText,
    run_url: runUrl,
  });
  const kinds = secretKinds(renderOutcome(note));
  if (kinds.length)
    throw new Error(
      `The note holds a secret-shaped value (${kinds.join(', ')})`,
    );
  return note;
}

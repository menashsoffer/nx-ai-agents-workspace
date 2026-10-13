// Secret guards for the pipeline engine. An issue (the request) that
// carries something shaped like a credential never reaches the model; the
// engine stops before the agent step. The agent's output (its JSON, the
// patch it wrote, the PR title and body built from them) is scanned the
// same way before anything is published or posted. Either way the engine
// reports which field and which kind of secret it saw, never the value.
//
// Pure: no I/O.

/**
 * Credential shapes, each with a kind that is safe to print. Prefixes are
 * the issuers' documented ones; the patterns are anchored on word
 * boundaries so ordinary prose does not match.
 */
const SECRET_PATTERNS = [
  ['github_token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/],
  ['github_token', /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['anthropic_key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai_key', /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['slack_token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['private_key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

/** Kinds of secret found in one text, deduplicated, in pattern order. */
export function secretKinds(text) {
  const value = String(text ?? '');
  const kinds = [];
  for (const [kind, pattern] of SECRET_PATTERNS)
    if (pattern.test(value) && !kinds.includes(kind)) kinds.push(kind);
  return kinds;
}

/**
 * Scans the request the agents would read (the collect-issue output of
 * pipeline.mjs: title, body, spec, plan and every comment). Returns
 * `{ isClean, findings }` with findings like `{ field: 'comments[2].body',
 * kinds: ['github_token'] }`.
 */
export function scanRequest(request) {
  const findings = [];
  const scan = (field, text) => {
    const kinds = secretKinds(text);
    if (kinds.length) findings.push({ field, kinds });
  };
  const source = request && typeof request === 'object' ? request : {};
  for (const field of ['title', 'body', 'spec', 'plan'])
    scan(field, source[field]);
  const comments = Array.isArray(source.comments) ? source.comments : [];
  comments.forEach((comment, index) =>
    scan(`comments[${index}].body`, comment?.body),
  );
  return { isClean: findings.length === 0, findings };
}

/**
 * The outcome note for a request that was stopped. It uses the existing
 * hard gate `needs_secrets_ci_infra` (a person must look; no automation
 * routes around it) and names only fields and kinds.
 */
export function requestOutcome(stage, findings) {
  return {
    stage,
    result: 'problem',
    problem: 'needs_secrets_ci_infra',
    summary:
      'The request contains a value shaped like a secret, so it was not sent to the agent. Remove the value (and rotate it), then restart.',
    details: findings.map(
      (finding) =>
        `secret_in_request: ${finding.field} (${finding.kinds.join(', ')})`,
    ),
  };
}

/** Every string inside a parsed JSON value, with its path (`result.pr_body`). */
function stringLeaves(value, path, leaves = []) {
  if (typeof value === 'string') leaves.push([path, value]);
  else if (Array.isArray(value))
    value.forEach((item, index) =>
      stringLeaves(item, `${path}[${index}]`, leaves),
    );
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value))
      stringLeaves(item, `${path}.${key}`, leaves);
  return leaves;
}

/** The lines a patch adds (what would land in the repository). */
const addedLines = (patch) =>
  String(patch ?? '')
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');

/**
 * Scans what the agent produced: `result` (its raw JSON text), `patch` and
 * any other named `texts` (for example the PR body). Returns `{ isClean,
 * findings }` like scanRequest.
 */
export function scanOutput({ result = '', patch = '', texts = {} }) {
  const findings = [];
  const scan = (field, text) => {
    const kinds = secretKinds(text);
    if (kinds.length) findings.push({ field, kinds });
  };
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) scan('result', result);
  else
    for (const [field, text] of stringLeaves(parsed, 'result'))
      scan(field, text);
  scan('patch', addedLines(patch));
  for (const [field, text] of Object.entries(texts)) scan(field, text);
  return { isClean: findings.length === 0, findings };
}

/** The outcome note for agent output that held a secret-shaped value. */
export function outputOutcome(stage, findings) {
  return {
    stage,
    result: 'problem',
    problem: 'needs_secrets_ci_infra',
    summary:
      "The agent's output contains a value shaped like a secret, so nothing from it was published. Check where it came from (and rotate it).",
    details: findings.map(
      (finding) =>
        `secret_in_output: ${finding.field} (${finding.kinds.join(', ')})`,
    ),
  };
}

// Secret guard for the pipeline engine's request: an issue that carries
// something shaped like a credential never reaches the model; the engine
// stops before the agent step. The agent's output is scanned with the same
// patterns (engine-output-scan.mjs). Either way the engine reports which
// field and which kind of secret it saw, never the value.
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

/** Every kind name secretKinds can report. */
export const SECRET_KINDS = Object.freeze([
  ...new Set(SECRET_PATTERNS.map(([kind]) => kind)),
]);

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

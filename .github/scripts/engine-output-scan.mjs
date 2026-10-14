// Secret scan of what the agent produced, before any of it is published:
// its JSON, every publishable part of its patch (commit subject, body and
// author from the format-patch headers; file names, diff headers and added
// lines), the commits that would be pushed (author, committer, subject,
// body), and texts built from them such as the PR body.
//
// Field names are engine-made and drawn from a closed set (OUTPUT_FIELD),
// so a finding can be posted without repeating anything the agent chose.
//
// Pure: no I/O.
import { secretKinds } from './engine-request.mjs';

/** Every field name scanOutput and scanCommits can report. */
export const OUTPUT_FIELD =
  /^(?:result(?:\.(?:status|problem|questions|details|signals|spec|plan|pr_title|pr_body|blocked_reason|other))?|patch\.(?:subject|body|author|diff)|commit\.(?:author|committer|subject|body)|text\.(?:[a-z][a-z-]{0,30}\.(?:md|txt|json)|other))$/;

const MAIL_START = /^From [0-9a-f]{40} /;

/**
 * Splits a format-patch mbox into the parts that get published: `subject`,
 * `body` (the commit message), `author` (the From: header) and `diff`
 * (diffstat, file names, diff headers and added lines; context and removed
 * lines are already in the repository). A plain diff is all `diff`.
 */
export function patchSections(patch) {
  const sections = { subject: [], body: [], author: [], diff: [] };
  let part = 'diff';
  let header = '';
  for (const line of String(patch ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    if (MAIL_START.test(line)) {
      part = 'headers';
      continue;
    }
    if (part === 'headers') {
      if (line === '') part = 'body';
      else if (/^[ \t]/.test(line) && header) sections[header].push(line);
      else {
        header = /^From: /i.test(line)
          ? 'author'
          : /^Subject: /i.test(line)
            ? 'subject'
            : '';
        if (header) sections[header].push(line);
      }
      continue;
    }
    if (part === 'body') {
      if (line !== '---' && !line.startsWith('diff --git ')) {
        sections.body.push(line);
        continue;
      }
      part = 'diff';
    }
    if (/^[ -]/.test(line) && !/^--- /.test(line)) continue;
    sections.diff.push(line);
  }
  return Object.fromEntries(
    Object.entries(sections).map(([name, lines]) => [name, lines.join('\n')]),
  );
}

/** The planner's and the developer's top-level JSON keys (their schemas). */
const RESULT_KEYS = [
  'status',
  'problem',
  'questions',
  'details',
  'signals',
  'spec',
  'plan',
  'pr_title',
  'pr_body',
  'blocked_reason',
];
const TEXT_NAME = /^[a-z][a-z-]{0,30}\.(?:md|txt|json)$/;

const topLevelField = (key) =>
  RESULT_KEYS.includes(key) ? `result.${key}` : 'result.other';

/** Every string inside a JSON value. */
function strings(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) strings(item, found);
  return found;
}

function collect(entries) {
  const findings = [];
  for (const [field, text] of entries) {
    const kinds = secretKinds(text);
    if (!kinds.length) continue;
    const existing = findings.find((finding) => finding.field === field);
    if (existing) existing.kinds = [...new Set([...existing.kinds, ...kinds])];
    else findings.push({ field, kinds });
  }
  return { isClean: findings.length === 0, findings };
}

/**
 * Scans `result` (the agent's raw JSON text), `patch` (format-patch text)
 * and named `texts`. Returns `{ isClean, findings }`.
 */
export function scanOutput({ result = '', patch = '', texts = {} }) {
  const entries = [];
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === 'object')
    for (const [key, value] of Object.entries(parsed))
      entries.push([topLevelField(key), strings(value).join('\n')]);
  else entries.push(['result', String(result)]);
  for (const [name, text] of Object.entries(patchSections(patch)))
    entries.push([`patch.${name}`, text]);
  for (const [name, text] of Object.entries(texts))
    entries.push([TEXT_NAME.test(name) ? `text.${name}` : 'text.other', text]);
  return collect(entries);
}

/** The `git log` format scanCommits reads: fields split by NUL, commits by SOH. */
export const COMMIT_LOG_FORMAT = '%an <%ae>%x00%cn <%ce>%x00%s%x00%b%x01';

/** Scans `git log --format=COMMIT_LOG_FORMAT` output: what would be pushed. */
export function scanCommits(log) {
  const entries = [];
  for (const commit of String(log ?? '').split('\u0001')) {
    const [author = '', committer = '', subject = '', body = ''] =
      commit.split('\u0000');
    entries.push(
      ['commit.author', author],
      ['commit.committer', committer],
      ['commit.subject', subject],
      ['commit.body', body],
    );
  }
  return collect(entries);
}

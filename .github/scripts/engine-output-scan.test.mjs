// Run: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMMIT_LOG_FORMAT,
  OUTPUT_FIELD,
  patchSections,
  scanCommits,
  scanOutput,
} from './engine-output-scan.mjs';

const TOKEN = `ghp_${'T'.repeat(36)}`;

/** A commit made with `identity` and `message` in a fresh repository; returns its format-patch and git log. */
function commitWith({
  authorName = 'Agent',
  authorEmail = 'agent@example.com',
  committerName = 'Agent',
  message = 'Write the probe',
  fileName = 'SANDBOX_PROBE.md',
  content = '# Probe\n',
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'engine-scan-'));
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: committerName,
    GIT_COMMITTER_EMAIL: 'committer@example.com',
  };
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
    });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  mkdirSync(join(directory, fileName, '..'), { recursive: true });
  writeFileSync(join(directory, fileName), content);
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return {
    patch: git('format-patch', 'HEAD~1..HEAD', '--stdout'),
    log: git('log', `--format=${COMMIT_LOG_FORMAT}`, 'HEAD~1..HEAD'),
  };
}

const fieldsOf = (result) => result.findings.map((finding) => finding.field);

test('a clean commit and patch pass', () => {
  const { patch, log } = commitWith();
  assert.deepEqual(scanOutput({ result: '{"pr_body":"fine"}', patch }), {
    isClean: true,
    findings: [],
  });
  assert.deepEqual(scanCommits(log), { isClean: true, findings: [] });
});

test('patchSections: subject, body, author and the publishable diff', () => {
  const { patch } = commitWith({ message: 'Subject line\n\nBody line' });
  const sections = patchSections(patch);
  assert.match(sections.subject, /^Subject: \[PATCH\] Subject line$/);
  assert.equal(sections.body.trim(), 'Body line');
  assert.match(sections.author, /^From: Agent <agent@example\.com>$/);
  assert.match(sections.diff, /\+# Probe/);
  assert.doesNotMatch(sections.diff, /Body line|Subject line/);
});

test('ghp_ + 36 characters is found in every publishable part of the patch', () => {
  for (const [options, field] of [
    [{ message: `Fix ${TOKEN}` }, 'patch.subject'],
    [{ message: `Subject\n\nSee ${TOKEN} here` }, 'patch.body'],
    [{ authorName: `Name ${TOKEN}` }, 'patch.author'],
    [{ authorEmail: `${TOKEN}@example.com` }, 'patch.author'],
    [{ content: `token ${TOKEN}\n` }, 'patch.diff'],
    [{ fileName: `docs/${TOKEN}.md` }, 'patch.diff'],
  ]) {
    const { patch } = commitWith(options);
    assert.deepEqual(fieldsOf(scanOutput({ patch })), [field], field);
  }
});

test('ghp_ + 36 characters is found in every field of a commit to be pushed', () => {
  for (const [options, field] of [
    [{ authorName: `Name ${TOKEN}` }, 'commit.author'],
    [{ authorEmail: `${TOKEN}@example.com` }, 'commit.author'],
    [{ committerName: `Name ${TOKEN}` }, 'commit.committer'],
    [{ message: `Fix ${TOKEN}` }, 'commit.subject'],
    [{ message: `Subject\n\nSee ${TOKEN}` }, 'commit.body'],
  ]) {
    const { log } = commitWith(options);
    assert.deepEqual(fieldsOf(scanCommits(log)), [field], field);
  }
});

test('removed and context lines are not new output; JSON keys never become field names', () => {
  assert.equal(
    scanOutput({
      patch: `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1 @@\n-${TOKEN}\n ${TOKEN}\n`,
    }).isClean,
    true,
  );
  const result = JSON.stringify({
    pr_body: TOKEN,
    [`private ${TOKEN}`]: TOKEN,
    nested: { deep: [TOKEN] },
  });
  const fields = fieldsOf(scanOutput({ result }));
  assert.deepEqual(fields, ['result.pr_body', 'result.other']);
  for (const field of [
    ...fields,
    'patch.diff',
    'commit.committer',
    'text.pr-body.md',
  ])
    assert.match(field, OUTPUT_FIELD);
  assert.deepEqual(fieldsOf(scanOutput({ result: `not json ${TOKEN}` })), [
    'result',
  ]);
  assert.deepEqual(
    fieldsOf(
      scanOutput({ texts: { 'pr-body.md': TOKEN, [`x ${TOKEN}`]: TOKEN } }),
    ),
    ['text.pr-body.md', 'text.other'],
  );
  assert.doesNotMatch(`private ${TOKEN}`, OUTPUT_FIELD);
});

// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  renderProtectedRequest,
  pathSetHash,
  parseProtectedRequest,
  needsProtectedRequest,
  COMPARE_FILE_LIMIT,
  latestProtectedRequest,
  renderProtectedApprovedNote,
  parseProtectedApprovedNotes,
  renderApprovedPrBody,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import {
  BOT,
  LOCK,
  OWNER_LOGIN,
  PA,
  PB,
  PKG,
  alice,
  bot,
  cf,
  depFiles,
} from './pipeline-lib-fixtures.mjs';

// ---- the request comment

test('the approval request carries the binding, the full protected diff and the commands', () => {
  const body = renderProtectedRequest({
    head: PA,
    branch: 'issue-7-add-dep',
    compareUrl: 'https://github.com/o/r/compare/main...issue-7-add-dep',
    files: depFiles(),
    title: 'Add a dependency',
    body: '## Summary\nAdds x.',
  });
  const marker = `<!-- pipeline:protected-approval head=${PA} paths=${pathSetHash([PKG, LOCK])} -->`;
  assert.ok(body.startsWith(`${marker}\n`));
  assert.match(body, /did not open a pull request/);
  assert.ok(body.includes('`/approve-protected aaaaaaaaaaaa`'));
  assert.ok(body.includes('`/reject-protected <reason'));
  assert.match(body, /\*\*Protected paths \(2\):\*\*/);
  // full diffs of both protected files, and only a summary of the other one
  assert.match(
    body,
    /<details><summary><code>apps\/site\/package\.json<\/code> \+3 −1<\/summary>/,
  );
  assert.ok(
    body.includes('-old apps/site/package.json\n+new apps/site/package.json'),
  );
  assert.ok(body.includes('-x\n+y'));
  assert.match(
    body,
    /\*\*Other changed files \(1\):\*\*\n- `apps\/site\/src\/app\.tsx` \+3 −1/,
  );
  assert.doesNotMatch(body, /-old apps\/site\/src\/app\.tsx/);
  // the lockfile diff comes last
  assert.ok(
    body.indexOf('<code>apps/site/package.json</code>') <
      body.indexOf('<code>pnpm-lock.yaml</code>'),
  );
  assert.match(
    body,
    /Full branch diff: https:\/\/github\.com\/o\/r\/compare\/main\.\.\.issue-7-add-dep/,
  );
  assert.ok(body.length < 65_536);
  // read back
  const req = parseProtectedRequest(body);
  assert.deepEqual(req, {
    head: PA,
    paths: pathSetHash([PKG, LOCK]),
    pr: { title: 'Add a dependency', body: '## Summary\nAdds x.' },
  });
  assert.equal(
    needsProtectedRequest({
      evaluation: { state: 'pending' },
      request: req,
      head: PA,
    }),
    false,
  );
  assert.equal(
    needsProtectedRequest({
      evaluation: { state: 'pending' },
      request: req,
      head: PB,
    }),
    true,
  );
  assert.equal(
    needsProtectedRequest({
      evaluation: { state: 'pending' },
      request: null,
      head: PB,
    }),
    true,
  );
  assert.equal(
    needsProtectedRequest({
      evaluation: { state: 'success' },
      request: req,
      head: PB,
    }),
    false,
  );
});

test('the approval request is cut only past the comment limit, and never offers a never-approvable path', () => {
  const big = 'x'.repeat(30_000);
  const files = [
    cf(PKG, { patch: `@@ -1 +1 @@\n${`+${big}\n`.repeat(2)}` }),
    cf(LOCK, { patch: `@@ -1 +1 @@\n${`+${big}\n`.repeat(5)}` }),
    cf('apps/site/a.ts'),
  ];
  const body = renderProtectedRequest({
    head: PA,
    branch: 'issue-7-x',
    compareUrl: 'https://github.com/o/r/compare/main...issue-7-x',
    files,
  });
  assert.ok(body.length <= 65_536, `${body.length}`);
  assert.match(body, /Truncated: the diff does not fit/);
  // the first file was whole; the header and the json tail survive the cut
  assert.ok(body.includes(`+${big}\n+${big}`));
  assert.ok(parseProtectedRequest(body));
  // a small diff is never cut
  assert.doesNotMatch(
    renderProtectedRequest({
      head: PA,
      branch: 'issue-7-x',
      compareUrl: 'u',
      files: depFiles(),
    }),
    /Truncated/,
  );
  // no patch from the API (binary / huge): says so instead of a diff
  assert.match(
    renderProtectedRequest({
      head: PA,
      branch: 'issue-7-x',
      compareUrl: 'u',
      files: [cf(PKG, { patch: undefined })],
    }),
    /returned no diff for this file/,
  );
  const offer = (files) =>
    renderProtectedRequest({
      head: PA,
      branch: 'issue-7-x',
      compareUrl: 'u',
      files,
    });
  assert.throws(
    () => offer([cf(PKG), cf('.github/workflows/x.yml')]),
    /never-approvable/,
  );
  assert.throws(() => offer([cf('apps/site/a.ts')]), /no protected paths/);
  assert.throws(
    () => offer(Array.from({ length: COMPARE_FILE_LIMIT }, () => cf(PKG))),
    /incomplete/,
  );
});

test('diff text cannot forge markers, close fences or break the details block', () => {
  const evil = [
    '@@ -1 +1 @@',
    '+<!-- pipeline:protected-approval head=' +
      PB +
      ' paths=' +
      'c'.repeat(64) +
      ' -->',
    '+````',
    '+</details>',
    '+```json',
    '+{"v":1,"title":"evil","body":"evil"}',
    '+```',
  ].join('\n');
  const body = renderProtectedRequest({
    head: PA,
    branch: 'issue-7-x',
    compareUrl: 'u',
    files: [cf(PKG, { patch: evil })],
    title: 't',
    body: '<!-- pipeline:protected-approved issue=1 -->',
  });
  // only the header at the very start counts
  assert.equal(parseProtectedRequest(body).head, PA);
  assert.deepEqual(parseProtectedRequest(body).pr, {
    title: 't',
    body: '&lt;!-- pipeline:protected-approved issue=1 -->',
  });
  // the fence around the diff is longer than any backtick run inside it
  assert.match(body, /`{5}diff\n/);
  assert.equal(parseProtectedRequest('text\n' + body), null);
  assert.equal(
    parseProtectedRequest(
      `<!-- pipeline:protected-approval head=zz paths=x -->\n`,
    ),
    null,
  );
});

test('latestProtectedRequest trusts only the bot and takes the newest', () => {
  const mk = (head, files = depFiles()) =>
    renderProtectedRequest({
      head,
      branch: 'issue-7-x',
      compareUrl: 'u',
      files,
    });
  const comments = [
    { id: 1, user: bot, body: mk(PA) },
    { id: 2, user: bot, body: 'Not applied: something.' },
    { id: 3, user: alice, body: mk('c'.repeat(40)) }, // forged by a person
    { id: 4, user: bot, body: mk(PB) },
    { id: 5, user: alice, body: mk('d'.repeat(40)) },
  ];
  const latest = latestProtectedRequest(comments, BOT);
  assert.equal(latest.head, PB);
  assert.equal(latest.commentId, 4);
  assert.equal(latestProtectedRequest(comments.slice(0, 1), BOT).head, PA);
  assert.equal(latestProtectedRequest([comments[2]], BOT), null);
  assert.equal(latestProtectedRequest(comments, ''), null);
});

test('approval records: rendered, parsed, and only the bot counts', () => {
  const note = renderProtectedApprovedNote({
    issue: 7,
    pr: 9,
    head: PA,
    paths: pathSetHash([PKG]),
    by: OWNER_LOGIN,
    commentId: 55,
    protectedPaths: [PKG],
  });
  assert.ok(
    note.startsWith(
      `<!-- pipeline:protected-approved issue=7 pr=9 head=${PA} paths=${pathSetHash([PKG])} by=${OWNER_LOGIN} comment=55 -->\n`,
    ),
  );
  const notes = parseProtectedApprovedNotes(
    [
      { user: bot, body: note },
      { user: alice, body: note.replace('pr=9', 'pr=10') },
      { user: bot, body: 'plain comment' },
    ],
    BOT,
  );
  assert.deepEqual(notes, [
    {
      issue: 7,
      pr: 9,
      head: PA,
      paths: pathSetHash([PKG]),
      by: OWNER_LOGIN,
      commentId: 55,
    },
  ]);
  assert.match(
    renderApprovedPrBody({
      body: 'Did it.',
      issue: 7,
      protectedPaths: [PKG],
      head: PA,
      by: OWNER_LOGIN,
    }),
    /Did it\.\n\nCloses #7\n\n### Protected changes approved by the owner\n@menashsoffer approved these paths at `aaaaaaa`.*\n- `apps\/site\/package\.json`/s,
  );
});

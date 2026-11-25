// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProtectedCommand,
  protectedOfCompare,
  decideProtectedCommand,
  COMPARE_FILE_LIMIT,
  APPROVE_COMMAND,
  REJECT_COMMAND,
} from './pipeline-lib.mjs';
import {
  LOCK,
  OWNER_LOGIN,
  PA,
  PB,
  PKG,
  cf,
  depFiles,
} from './pipeline-lib-fixtures.mjs';

// ---- commands

test('parseProtectedCommand accepts exactly one command and nothing else', () => {
  assert.deepEqual(
    parseProtectedCommand(`/approve-protected ${PA.slice(0, 12)}`),
    {
      ok: true,
      kind: 'approve',
      prefix: 'a'.repeat(12),
    },
  );
  assert.deepEqual(
    parseProtectedCommand('  /approve-protected 0123456789ab \r\n'),
    { ok: true, kind: 'approve', prefix: '0123456789ab' },
  );
  const r = parseProtectedCommand(
    '/reject-protected the new dependency is unwanted',
  );
  assert.deepEqual(r, {
    ok: true,
    kind: 'reject',
    reason: 'the new dependency is unwanted',
  });
  // not commands: ordinary discussion (also lookalikes)
  for (const body of [
    '',
    undefined,
    'looks good',
    'please /approve-protected 0123456789ab',
    'thanks\n/approve-protected 0123456789ab', // text before it: not a command
    '/approve-protectedx 0123456789ab',
    '/approve 0123456789ab',
  ])
    assert.deepEqual(parseProtectedCommand(body), { ok: false, ignore: true });
  // commands that cannot be honoured, each with a reason
  const bad = (body) => {
    const p = parseProtectedCommand(body);
    assert.equal(p.ok, false, body);
    assert.equal(p.ignore, undefined, body);
    assert.ok(p.error.length > 5);
    return p.error;
  };
  assert.match(bad('/approve-protected'), /expected/);
  assert.match(bad('/approve-protected abc'), /expected/);
  assert.match(bad('/approve-protected 0123456789AB'), /expected/); // uppercase
  assert.match(bad('/approve-protected 0123456789abc'), /expected/); // 13
  assert.match(bad('/approve-protected 0123456789ab now'), /expected/);
  assert.match(bad('/approve-protected 0123456789ab\nthanks!'), /one command/);
  assert.match(
    bad('/approve-protected 0123456789ab\n/approve-protected 0123456789ab'),
    /one command/,
  );
  assert.match(bad('/reject-protected'), /expected/);
  assert.match(bad('/reject-protected too short'), /at least 10/);
  assert.match(bad(`/reject-protected ${'x'.repeat(501)}`), /at most 500/);
  assert.match(
    bad('/reject-protected a long enough reason\nsecond line'),
    /one command/,
  );
  // error text never repeats the body
  assert.doesNotMatch(
    bad('/approve-protected <script>alert(1)</script>'),
    /script/,
  );
});

// The inputs decideProtectedCommand needs for a healthy approval.
const healthy = (over = {}) => {
  const changed = protectedOfCompare(depFiles());
  return {
    comment: {
      body: `/approve-protected ${PA.slice(0, 12)}`,
      login: OWNER_LOGIN,
      type: 'User',
    },
    ownerLogin: OWNER_LOGIN,
    edited: false,
    issue: {
      state: 'open',
      isPullRequest: false,
      labels: ['stage:awaiting-approval'],
    },
    request: { head: PA, paths: changed.hash, pr: null },
    branchHeads: [PA],
    changed,
    ...over,
  };
};

test('decideProtectedCommand: the owner approves a healthy request', () => {
  const d = decideProtectedCommand(healthy());
  assert.equal(d.action, 'approve');
  assert.equal(d.head, PA);
  assert.equal(d.paths, protectedOfCompare(depFiles()).hash);
  assert.deepEqual(d.protectedPaths, [LOCK, PKG].sort());
  // login comparison is case-insensitive like everywhere else
  assert.equal(
    decideProtectedCommand(
      healthy({ comment: { ...healthy().comment, login: 'MenashSoffer' } }),
    ).action,
    'approve',
  );
});

test('decideProtectedCommand: every reason to refuse leaves the state alone', () => {
  const refused = (over, re) => {
    const d = decideProtectedCommand(healthy(over));
    assert.equal(d.action, 'reply', JSON.stringify(d));
    assert.match(d.reason, re);
    return d;
  };
  const comment = (over) => ({ ...healthy().comment, ...over });

  // 1. the commenter
  refused({ comment: comment({ login: 'mallory' }) }, /not the pipeline owner/);
  // a stranger's reject is refused too
  refused(
    {
      comment: comment({
        login: 'mallory',
        body: '/reject-protected not wanted at all',
      }),
    },
    /not the pipeline owner/,
  );
  // a non-user (a bot) is ignored, with no reply, and so is no owner at all
  assert.equal(
    decideProtectedCommand(healthy({ comment: comment({ type: 'Bot' }) }))
      .action,
    'ignore',
  );
  assert.equal(
    decideProtectedCommand(healthy({ ownerLogin: '' })).action,
    'ignore',
  );
  assert.equal(
    decideProtectedCommand(healthy({ ownerLogin: undefined })).action,
    'ignore',
  );
  // not a command at all: ignored, whoever wrote it
  assert.equal(
    decideProtectedCommand(healthy({ comment: comment({ body: 'lgtm' }) }))
      .action,
    'ignore',
  );
  assert.equal(
    decideProtectedCommand(
      healthy({ comment: comment({ login: 'mallory', body: 'lgtm' }) }),
    ).action,
    'ignore',
  );
  // 2. extra text or a malformed command
  refused(
    {
      comment: comment({
        body: `/approve-protected ${PA.slice(0, 12)}\nplease`,
      }),
    },
    /one command/,
  );
  refused({ comment: comment({ body: '/approve-protected 123' }) }, /expected/);
  // 3. an edited comment
  refused({ edited: true }, /edited/);
  // 4. the issue's state
  refused(
    { issue: { ...healthy().issue, labels: ['stage:building'] } },
    /not awaiting approval/,
  );
  refused(
    { issue: { ...healthy().issue, labels: [] } },
    /not awaiting approval/,
  );
  refused({ issue: { ...healthy().issue, state: 'closed' } }, /closed/);
  refused(
    { issue: { ...healthy().issue, isPullRequest: true } },
    /pull request/,
  );
  refused({ request: null }, /no approval request/);
  // 5. a stale SHA: it names an older head than the latest request
  refused(
    { comment: comment({ body: `/approve-protected ${PB.slice(0, 12)}` }) },
    /stale.*latest request is for `a{12}`/,
  );
  // 6. the branch moved (or was deleted) since the request
  refused({ branchHeads: [PB] }, /no longer points/);
  refused({ branchHeads: [] }, /no longer points/);
  // 7. the recomputed path set differs from the recorded one
  refused(
    { changed: protectedOfCompare([cf(PKG), cf('apps/x/package.json')]) },
    /set of protected paths changed/,
  );
  refused(
    { changed: protectedOfCompare([cf(PKG)]) },
    /set of protected paths changed/,
  );
  // 8. a path became non-approvable (recorded hash covers it, but it is never approvable)
  const nowNever = protectedOfCompare([cf(PKG), cf('.github/workflows/x.yml')]);
  refused(
    {
      changed: nowNever,
      request: { head: PA, paths: nowNever.hash, pr: null },
    },
    /can no longer be approved: \.github\/workflows\/x\.yml/,
  );
  // a file list that may be cut off cannot be verified
  const long = protectedOfCompare(
    Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) => cf(`f${i}.ts`)),
  );
  refused({ changed: long }, /cannot be listed completely/);
  refused({ changed: null }, /cannot be listed completely/);
});

test('decideProtectedCommand: reject needs only the owner and an awaiting request', () => {
  const reject = healthy({
    comment: {
      ...healthy().comment,
      body: '/reject-protected the dependency is not needed',
    },
  });
  const d = decideProtectedCommand(reject);
  assert.deepEqual(d, {
    action: 'reject',
    reason: 'the dependency is not needed',
    head: PA,
  });
  // a stale head or a moved branch does not stop a rejection
  assert.equal(
    decideProtectedCommand({ ...reject, branchHeads: [PB] }).action,
    'reject',
  );
  // but the owner check, the stage and an edit still apply
  assert.equal(
    decideProtectedCommand({
      ...reject,
      comment: { ...reject.comment, login: 'mallory' },
    }).action,
    'reply',
  );
  assert.equal(
    decideProtectedCommand({ ...reject, edited: true }).action,
    'reply',
  );
  assert.equal(
    decideProtectedCommand({
      ...reject,
      issue: { ...reject.issue, labels: ['stage:routing'] },
    }).action,
    'reply',
  );
  assert.equal(APPROVE_COMMAND, '/approve-protected');
  assert.equal(REJECT_COMMAND, '/reject-protected');
});

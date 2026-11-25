// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  parseDispositionComment,
  DISPOSITION_KINDS,
  checkDispositionAuthor,
  validateDispositions,
  renderDispositionNote,
  parseDispositionNotes,
  dispositionKinds,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import {
  BOT,
  HEAD_A,
  HEAD_B,
  OWNER_LOGIN,
  alice,
  bot,
} from './pipeline-lib-fixtures.mjs';

test('parseDispositionComment accepts one or more exact lines', () => {
  const ok = parseDispositionComment(
    '/disposition C-100001 accepted-risk   The href is built from a constant.\n/disposition C-123456 false-positive The comment is about generated code\n',
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.commands, [
    {
      id: 'C-100001',
      kind: 'accepted-risk',
      reason: 'The href is built from a constant.',
    },
    {
      id: 'C-123456',
      kind: 'false-positive',
      reason: 'The comment is about generated code',
    },
  ]);
  for (const kind of DISPOSITION_KINDS)
    assert.equal(
      parseDispositionComment(`/disposition C-100001 ${kind} ten chars!!`).ok,
      true,
    );
  assert.equal(
    parseDispositionComment(
      '/disposition C-100001 out-of-scope Tracked in issue 12.\r\n',
    ).ok,
    true,
  );
});

test('parseDispositionComment rejects anything off, as a whole', () => {
  const bad = (text) => {
    const r = parseDispositionComment(text);
    assert.equal(r.ok, false, text);
    assert.ok(!r.ignore, `${text} is a command, not chat`);
    return r.error;
  };
  assert.match(
    bad('/disposition C-100001 wontfix This is a long enough reason'),
    /kind must be one of/,
  );
  assert.match(
    bad('/disposition C-100001 accepted-risk short'),
    /at least 10 characters/,
  );
  assert.match(
    bad('/disposition C-100001 accepted-risk 123456789'),
    /at least 10 characters/,
  );
  assert.match(bad('/disposition C-100001 accepted-risk'), /expected/);
  assert.match(bad('/disposition'), /expected/);
  assert.match(
    bad('/disposition C-XYZ accepted-risk a long enough reason'),
    /finding id/,
  );
  assert.match(
    bad('/disposition c-100001 accepted-risk a long enough reason'),
    /finding id/,
  );
  assert.match(
    bad('/disposition C-100001 accepted-risk ' + 'x'.repeat(501)),
    /at most 500/,
  );
  // One bad line among several rejects them all, and says which.
  assert.match(
    bad(
      '/disposition C-100001 accepted-risk a long enough reason\n/disposition C-100002 nope a long enough reason',
    ),
    /^line 2: the kind/,
  );
  // Prose around a command, an empty line, a duplicate id, too many lines.
  assert.match(
    bad('/disposition C-100001 accepted-risk a long enough reason\nthanks!'),
    /^line 2: expected/,
  );
  assert.match(
    bad(
      '/disposition C-100001 accepted-risk a long enough reason\n\n/disposition C-100002 accepted-risk a long enough reason',
    ),
    /^line 2: expected/,
  );
  assert.match(
    bad(
      '/disposition C-100001 accepted-risk a long enough reason\n/disposition C-100001 false-positive another long reason',
    ),
    /appears twice/,
  );
  assert.match(
    bad(
      Array(21)
        .fill('/disposition C-100001 accepted-risk a long enough reason')
        .join('\n'),
    ),
    /at most 20/,
  );
  // The error never repeats untrusted text.
  assert.ok(
    !bad(
      '/disposition <script>alert(1)</script> accepted-risk a long enough reason',
    ).includes('script'),
  );
});

test('parseDispositionComment leaves ordinary comments alone', () => {
  for (const text of [
    'looks good',
    '',
    null,
    'please /disposition C-100001 accepted-risk a long enough reason',
    '> /disposition C-100001 accepted-risk a long enough reason',
    '/dispositions C-100001 accepted-risk a long enough reason',
  ])
    assert.deepEqual(
      parseDispositionComment(text),
      { ok: false, ignore: true },
      String(text),
    );
});

test('checkDispositionAuthor: the configured owner as a user, nobody else, closed when unset', () => {
  const check = (extra) =>
    checkDispositionAuthor({
      login: OWNER_LOGIN,
      type: 'User',
      ownerLogin: OWNER_LOGIN,
      ...extra,
    });
  assert.equal(check({}).ok, true);
  assert.equal(
    check({ login: 'MenashSoffer' }).ok,
    true,
    'logins are case-insensitive',
  );
  assert.equal(check({ login: 'alice' }).ok, false);
  assert.equal(check({ type: 'Bot' }).ok, false);
  assert.equal(check({ login: `${OWNER_LOGIN}[bot]`, type: 'Bot' }).ok, false);
  assert.equal(check({ ownerLogin: '' }).ok, false);
  assert.equal(check({ ownerLogin: undefined }).ok, false);
  assert.equal(
    checkDispositionAuthor({ login: '', type: 'User', ownerLogin: '' }).ok,
    false,
  );
  // The commenter's association or authorship is not consulted.
  assert.equal(
    checkDispositionAuthor({
      login: 'alice',
      type: 'User',
      ownerLogin: OWNER_LOGIN,
      author_association: 'OWNER',
    }).ok,
    false,
  );
});

test('validateDispositions: ids must be an open finding thread', () => {
  const findingIds = new Set(['C-42', 'R-7']);
  const cmd = (id) => ({
    id,
    kind: 'accepted-risk',
    reason: 'a long enough reason',
  });
  assert.equal(
    validateDispositions({ commands: [cmd('C-42'), cmd('R-7')], findingIds })
      .ok,
    true,
  );
  // One unknown id rejects all.
  const unknown = validateDispositions({
    commands: [cmd('C-42'), cmd('C-43')],
    findingIds,
  });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /C-43 is not an open review finding thread/);
  // No open Copilot thread at all.
  assert.equal(validateDispositions({ commands: [cmd('C-42')] }).ok, false);
});

test('disposition record notes round-trip, are inert, and count only from the bot', () => {
  const rec = {
    id: 'C-100001',
    kind: 'accepted-risk',
    head: HEAD_A,
    by: OWNER_LOGIN,
    commentId: 987,
    reason: 'Uses ``` fences and <!-- pipeline-state --> markers.',
  };
  const note = renderDispositionNote(rec);
  assert.ok(
    note.startsWith(
      `<!-- pipeline:disposition id=C-100001 kind=accepted-risk head=${HEAD_A} by=${OWNER_LOGIN} comment=987 -->\n`,
    ),
  );
  assert.ok(
    !note.includes('<!-- pipeline-state'),
    'markers in the reason are neutralised',
  );
  const [parsed] = parseDispositionNotes([{ user: bot, body: note }], BOT);
  assert.deepEqual(
    { ...parsed, reason: undefined },
    { ...rec, reason: undefined },
  );
  assert.ok(parsed.reason.includes('Uses ``` fences'));
  // A copy of the note from anyone else is ignored.
  assert.deepEqual(
    parseDispositionNotes([{ user: alice, body: note }], BOT),
    [],
  );
  assert.deepEqual(
    parseDispositionNotes(
      [{ user: bot, body: note.replace('C-100001', 'C-nothex!!') }],
      BOT,
    ),
    [],
  );
  assert.deepEqual(
    parseDispositionNotes([{ user: bot, body: `text\n${note}` }], BOT),
    [],
  );
});

test('only the owner’s dispositions count, and the latest record of a thread wins', () => {
  const record = (id, head, by = OWNER_LOGIN, kind = 'accepted-risk') => ({
    user: bot,
    body: renderDispositionNote({
      id,
      kind,
      head,
      by,
      commentId: 1,
      reason: 'a long enough reason',
    }),
  });
  const records = parseDispositionNotes(
    [
      record('C-1', HEAD_A),
      record('C-2', HEAD_A, 'mallory'),
      record('C-7', HEAD_A, OWNER_LOGIN, 'out-of-scope'),
      record('C-1', HEAD_B, OWNER_LOGIN, 'false-positive'),
    ],
    BOT,
  );
  assert.deepEqual(
    [...dispositionKinds({ records, ownerLogin: OWNER_LOGIN })],
    [
      ['C-1', 'false-positive'],
      ['C-7', 'out-of-scope'],
    ],
  );
  // No owner configured: no record counts.
  assert.equal(dispositionKinds({ records, ownerLogin: '' }).size, 0);
});

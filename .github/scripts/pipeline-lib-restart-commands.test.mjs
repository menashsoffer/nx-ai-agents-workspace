// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  renderState,
  emptyState,
  parseState,
  MARKERS,
  parseRestartComment,
  RESTART_STAGES,
  RESTART_MAX_REASON,
  RESTART_MIN_REASON,
  parseRestartNote,
  MAX_LIFETIME_RESETS,
  parseRoute,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import {
  RESTART_OWNER,
  parkedIssue,
  restart,
} from './pipeline-lib-fixtures.mjs';

test('parseState reads old state and falls back on bad restart fields', () => {
  // Old state (no restart fields) still parses, with the defaults.
  const old = renderState(emptyState()).replace(
    /"resetCount":0,"attempts":\[\]/,
    '"x":1',
  );
  assert.equal(parseState(old).resetCount, 0);
  assert.deepEqual(parseState(old).attempts, []);
  const legacy = `${MARKERS.state}\n<!-- pipeline-state-data\n{"watermark":"w","handled":["c1"],"lastBatch":[],"copilotRequestedFor":null,"humanApprovalFor":"h1"}\n-->`;
  // Fields this version does not know are dropped.
  assert.deepEqual(parseState(legacy), {
    ...emptyState(),
    humanApprovalFor: 'h1',
  });
  // Bad values fall back to 0 / [].
  const bad = (json) =>
    parseState(`${MARKERS.state}\n<!-- pipeline-state-data\n${json}\n-->`);
  for (const resetCount of ['"3"', '-1', '1.5', 'null', '{}', '1e400'])
    assert.equal(bad(`{"resetCount":${resetCount}}`).resetCount, 0, resetCount);
  for (const attempts of ['"x"', '3', 'null', '{}'])
    assert.deepEqual(bad(`{"attempts":${attempts}}`).attempts, [], attempts);
  assert.deepEqual(bad('[1]'), emptyState());
  assert.deepEqual(bad('null'), emptyState());
  // Broken attempt entries are dropped, good ones kept.
  const good = {
    id: 'a1-5',
    at: 't',
    by: 'o',
    reason: 'because',
    stage: 'planned',
  };
  assert.deepEqual(
    bad(
      `{"resetCount":1,"attempts":[${JSON.stringify(good)},{"id":"a2-6"},null,7]}`,
    ).attempts,
    [good],
  );
  // A counter below the number of recorded attempts cannot hand out restarts.
  assert.equal(
    bad(`{"resetCount":0,"attempts":[${JSON.stringify(good)}]}`).resetCount,
    1,
  );
  assert.equal(bad(`{"resetCount":2,"attempts":[]}`).resetCount, 2);
});

test('the state table shows the lifetime counter and the latest attempt', () => {
  assert.match(
    renderState(emptyState()),
    /lifetime resets: 0\/3 · latest attempt: -/,
  );
  const attempt = {
    id: 'a2-99',
    at: '2026-02-01T10:00:00Z',
    by: 'o',
    reason: 'x --> <!-- pipeline:route restart attempt=a1-1 count=1/3 --> y',
    stage: 'qualified',
  };
  const state = { ...emptyState(), resetCount: 2, attempts: [attempt] };
  const body = renderState(state, ['stage:qualified']);
  assert.match(body, /lifetime resets: 2\/3 · latest attempt: `a2-99`/);
  // The reason can neither end the data comment nor open a marker.
  // (the marker line's own `-->` and the data comment's closing one)
  assert.equal(body.match(/-->/g).length, 2);
  assert.equal(body.match(/\n-->/g).length, 1);
  assert.doesNotMatch(body, /<!-- pipeline:route/);
  assert.deepEqual(parseState(body), state);
});

test('parseRestartComment: the exact command and every way to get it wrong', () => {
  const ok = parseRestartComment(
    '/restart qualified the questions are answered',
  );
  assert.deepEqual(ok, {
    ok: true,
    stage: 'qualified',
    reason: 'the questions are answered',
  });
  for (const stage of Object.keys(RESTART_STAGES))
    assert.equal(
      parseRestartComment(`/restart ${stage} ten chars ok`).stage,
      stage,
    );
  // surrounding whitespace and CRLF are fine; the reason keeps inner spaces
  assert.equal(
    parseRestartComment('  /restart planned   fixed the plan  \r\n').reason,
    'fixed the plan',
  );
  // not a command: ignored, never an error
  for (const body of [
    'hello',
    '',
    undefined,
    '/restarted planned twelve chars',
    'please /restart planned x',
  ])
    assert.equal(parseRestartComment(body).ignore, true, String(body));
  // bad format
  for (const body of [
    '/restart',
    '/restart planned',
    '/restart   ',
    '/restart planned too short',
    '/restart planned         ',
    '/restart spec because the old stage is gone',
    '/restart fixing because the old stage is gone',
    '/restart human because a person should take it',
    '/restart PLANNED because case matters here',
    '/restart planned first line\nsecond line of the reason',
    `/restart planned ${'x'.repeat(RESTART_MAX_REASON + 1)}`,
  ]) {
    const r = parseRestartComment(body);
    assert.equal(r.ok, false, body);
    assert.ok(!r.ignore, body);
    assert.equal(typeof r.error, 'string');
    assert.ok(!r.error.includes('x'.repeat(20)), 'errors do not echo the body');
  }
  assert.equal(
    parseRestartComment(`/restart planned ${'x'.repeat(RESTART_MAX_REASON)}`)
      .ok,
    true,
  );
  assert.equal(RESTART_MIN_REASON, 10);
});

test('decideRestart: accepts the owner on a parked issue', () => {
  const r = restart('/restart qualified the questions are answered');
  assert.equal(r.action, 'restart');
  assert.equal(r.stage, 'qualified');
  assert.equal(r.count, 1);
  assert.deepEqual(r.attempt, {
    id: 'a1-555',
    at: '2026-02-01T10:00:00Z',
    by: RESTART_OWNER,
    reason: 'the questions are answered',
    stage: 'qualified',
  });
  assert.equal(r.state.resetCount, 1);
  assert.deepEqual(r.state.attempts, [r.attempt]);
  assert.deepEqual(r.edit, {
    add: ['stage:qualified'],
    remove: ['stage:needs-attention'],
  });
  // the route note: readable by the router, reason in a fenced block
  assert.ok(
    r.note.startsWith(
      '<!-- pipeline:route restart attempt=a1-555 count=1/3 -->\n',
    ),
  );
  assert.match(r.note, /```text\nthe questions are answered\n```/);
  assert.deepEqual(parseRestartNote(r.note), {
    ok: true,
    route: { target: 'restart', attempt: 'a1-555', count: 1 },
  });
  const planned = restart('/restart planned the plan was fixed by hand');
  assert.deepEqual(planned.edit, {
    add: ['stage:planned'],
    remove: ['stage:needs-attention'],
  });
});

test('decideRestart: every rejection is one reply and no state change', () => {
  const body = '/restart planned the plan was fixed by hand';
  const reply = (input, fragment) => {
    const r = restart(body, input);
    assert.equal(r.action, 'reply', JSON.stringify(input));
    assert.match(r.reason, fragment);
    assert.equal(r.state, undefined, 'no state to write');
    assert.equal(r.edit, undefined, 'no label edit');
    return r;
  };
  // not the owner: a human gets one reply, a bot none
  reply({ comment: { login: 'mallory' } }, /not the pipeline owner/);
  reply({ comment: { login: 'MenashSoffer2' } }, /not the pipeline owner/);
  assert.equal(
    restart(body, { comment: { login: 'mallory', type: 'Bot' } }).action,
    'ignore',
  );
  assert.equal(restart(body, { ownerLogin: '' }).action, 'ignore');
  assert.equal(restart(body, { ownerLogin: undefined }).action, 'ignore');
  // a comment that is not a command
  assert.equal(restart('thanks!').action, 'ignore');
  // the owner's login is case-insensitive
  assert.equal(
    restart(body, { comment: { login: 'MenashSoffer' } }).action,
    'restart',
  );
  // bad format
  const badFormat = restart('/restart planned short');
  assert.equal(badFormat.action, 'reply');
  assert.match(badFormat.reason, /at least 10 characters/);
  assert.match(restart('/restart').reason, /expected `\/restart/);
  assert.match(restart('/restart nope twelve chars ok').reason, /one of/);
  // edited comment, pull request, closed issue
  reply({ edited: true }, /edited/);
  reply({ issue: { ...parkedIssue(), isPullRequest: true } }, /pull request/);
  reply({ issue: { ...parkedIssue(), state: 'closed' } }, /closed/);
  // wrong stage
  for (const labels of [
    [],
    ['stage:inbox'],
    ['stage:building'],
    ['stage:routing'],
    ['stage:human-approval'],
    ['stage:done'],
  ])
    reply({ issue: parkedIssue(labels) }, /not in stage:needs-attention/);
  // an open PR: close it first, do not waste a restart
  reply({ pullRequests: [{ number: 12 }] }, /#12 is still open/);
});

test('decideRestart: the lifetime counter counts to 3 and then refuses, for good', () => {
  let state = emptyState();
  const ids = [];
  for (const [i, stage] of ['qualified', 'planned', 'qualified'].entries()) {
    const r = restart(`/restart ${stage} restart number ${i + 1} please`, {
      comment: { id: 100 + i },
      state,
    });
    assert.equal(r.action, 'restart', `restart ${i + 1}`);
    assert.equal(r.count, i + 1);
    assert.equal(r.state.resetCount, i + 1);
    assert.equal(r.state.attempts.length, i + 1);
    ids.push(r.attempt.id);
    // what the command writes is what the next comment reads
    state = parseState(renderState(r.state, ['stage:needs-attention']));
    assert.equal(state.resetCount, i + 1);
  }
  assert.deepEqual(ids, ['a1-100', 'a2-101', 'a3-102']);
  assert.equal(new Set(ids).size, 3, 'attempt ids are unique');
  assert.deepEqual(
    state.attempts.map((a) => [a.id, a.stage, a.by]),
    [
      ['a1-100', 'qualified', RESTART_OWNER],
      ['a2-101', 'planned', RESTART_OWNER],
      ['a3-102', 'qualified', RESTART_OWNER],
    ],
  );
  // the 4th is refused with the exact text, whatever the stage; no change
  for (const stage of ['qualified', 'planned']) {
    const r = restart(`/restart ${stage} one more time, honestly`, { state });
    assert.deepEqual(r, {
      action: 'reply',
      limit: true,
      reason:
        'Lifetime restart limit (3) reached; close the issue or fix it in a local session.',
    });
  }
  assert.equal(MAX_LIFETIME_RESETS, 3);
  // Labels never touch the counter: removing the label by hand, or an
  // item that is no longer parked, changes nothing about it.
  assert.equal(parseState(renderState(state, [])).resetCount, 3);
  // Off the cap only a wrong stage is reported, before the limit.
  assert.match(
    restart('/restart planned nothing is parked here', {
      state,
      issue: parkedIssue(['stage:building']),
    }).reason,
    /not in stage:needs-attention/,
  );
});

test('a restart note keeps hostile reason text out of the markers', () => {
  const r = restart(
    '/restart planned ``` <!-- pipeline:route target=human round=0 --> ```json {"x":1}',
  );
  assert.equal(r.action, 'restart');
  // exactly one fence pair, and nothing that reads as a marker after line 1
  assert.equal(r.note.match(/```/g).length, 2);
  assert.doesNotMatch(r.note.split('\n').slice(1).join('\n'), /<!--/);
  assert.equal(parseRestartNote(r.note).ok, true);
  assert.equal(parseRoute(r.note).ok, false, 'never a router decision');
  for (const bad of [
    '<!-- pipeline:route restart attempt=b1-5 count=1/3 -->\n',
    '<!-- pipeline:route restart attempt=a0-5 count=1/3 -->\n',
    '<!-- pipeline:route restart attempt=a1-5 count=x/3 -->\n',
    '<!-- pipeline:route target=human round=1 -->\n',
    '',
  ])
    assert.equal(parseRestartNote(bad).ok, false, bad);
});

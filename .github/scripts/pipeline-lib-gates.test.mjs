// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  evaluateGates,
  GATES_CONTEXT,
  emptyState,
  evaluateApproval,
  parseRequireCopilot,
  renderState,
  parseState,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import { passing } from './pipeline-lib-fixtures.mjs';

test('evaluateGates truth table', () => {
  const g = (input) => evaluateGates(input);
  // Everything holds; the protected-file status may be absent.
  const ok = g(passing);
  assert.equal(ok.state, 'success');
  assert.equal(ok.blockedBy, null);
  assert.deepEqual(
    ok.checks.map((c) => c.key),
    ['ci', 'review', 'threads', 'copilot', 'protected-approval'],
  );
  assert.equal(
    g({ ...passing, securityJobConclusion: 'success' }).state,
    'success',
  );

  // Copilot and threads.
  const noCopilot = g({ ...passing, copilotReviewedHead: false });
  assert.equal(noCopilot.state, 'pending');
  assert.equal(noCopilot.blockedBy, 'copilot');
  const threads = g({ ...passing, unresolvedThreads: 2 });
  assert.equal(threads.state, 'pending');
  assert.equal(threads.blockedBy, 'threads');
  assert.match(threads.description, /2 unresolved review thread/);

  // CI.
  const ciFailed = g({ ...passing, ciConclusion: 'failure' });
  assert.equal(ciFailed.state, 'failure');
  assert.equal(ciFailed.blockedBy, 'ci');
  assert.equal(g({ ...passing, ciConclusion: 'timed_out' }).state, 'failure');
  assert.equal(g({ ...passing, ciConclusion: null }).state, 'pending');
  assert.equal(g({ ...passing, ciConclusion: 'cancelled' }).state, 'pending');
  assert.equal(
    g({ ...passing, securityJobConclusion: 'failure' }).state,
    'failure',
  );
  assert.equal(g({ ...passing, securityJobConclusion: null }).state, 'pending');
  // A real blocker wins over things that are merely missing.
  const both = g({
    ...passing,
    ciConclusion: 'failure',
    copilotReviewedHead: false,
  });
  assert.equal(both.state, 'failure');
  assert.equal(both.blockedBy, 'ci');

  // pipeline/protected-approval: a PR with no protected paths passes whatever
  // the status says; one that touches them needs success.
  for (const state of [null, undefined, 'success', 'pending', 'failure'])
    assert.equal(
      g({ ...passing, protectedRequired: false, protectedApprovalState: state })
        .state,
      'success',
      `no protected paths, status ${state}`,
    );
  assert.equal(g(passing).state, 'success', 'the default is: not required');
  const need = (state) =>
    g({ ...passing, protectedRequired: true, protectedApprovalState: state });
  assert.equal(need('success').state, 'success');
  for (const state of ['pending', null, undefined]) {
    const r = need(state);
    assert.equal(r.state, 'pending', String(state));
    assert.equal(r.blockedBy, 'protected-approval');
  }
  assert.equal(need('failure').state, 'failure');
  assert.equal(need('error').state, 'failure');
  assert.equal(need('failure').blockedBy, 'protected-approval');
  // a real blocker elsewhere is reported before a missing approval
  assert.equal(
    g({
      ...passing,
      ciConclusion: 'failure',
      protectedRequired: true,
      protectedApprovalState: 'pending',
    }).blockedBy,
    'ci',
  );

  // The description fits a commit status (140 characters).
  for (const input of [passing, { ...passing, unresolvedThreads: 12 }])
    assert.ok(`${g(input).description}`.length <= 140);
  assert.equal(GATES_CONTEXT, 'pipeline/gates');
});

test('evaluateApproval reports the gates and hands off only when they all hold', () => {
  const base = {
    prState: 'open',
    draft: true,
    labels: ['stage:building'],
    headSha: 'h1',
    unresolvedThreads: 0,
    state: emptyState(),
    ...passing,
    copilotReviewedHead: false,
  };
  const open = evaluateApproval({ ...base, unresolvedThreads: 1 });
  assert.equal(open.action, 'wait');
  assert.equal(open.gates.state, 'pending');
  // With every earlier gate holding the flow goes on to Copilot, then hands off.
  assert.equal(evaluateApproval(base).action, 'request-copilot');
  const reviewed = { ...base, copilotReviewedHead: true };
  const done = evaluateApproval(reviewed);
  assert.equal(done.action, 'human-approval');
  assert.equal(done.gates.state, 'success');
  // A pending protected-file approval holds the hand-off, not the Copilot request.
  const awaiting = {
    protectedRequired: true,
    protectedApprovalState: 'pending',
  };
  assert.equal(
    evaluateApproval({ ...base, ...awaiting }).action,
    'request-copilot',
  );
  const held = evaluateApproval({ ...reviewed, ...awaiting });
  assert.equal(held.action, 'wait');
  assert.equal(held.gates.blockedBy, 'protected-approval');
  // Parked PRs are left alone, but still get a status; closed ones get none.
  const parked = evaluateApproval({
    ...reviewed,
    labels: ['stage:needs-attention'],
  });
  assert.equal(parked.action, 'noop');
  assert.equal(parked.gates.state, 'success');
  const closed = evaluateApproval({ ...reviewed, prState: 'closed' });
  assert.equal(closed.action, 'noop');
  assert.equal(closed.gates, null);
  // Already handed off for this head: nothing to do.
  assert.equal(
    evaluateApproval({
      ...reviewed,
      draft: false,
      labels: ['stage:human-approval'],
      state: { ...emptyState(), humanApprovalFor: 'h1' },
    }).action,
    'noop',
  );
});

// ------------------------------------------------ optional Copilot gate

test('parseRequireCopilot: only the exact string `true` turns the gate on', () => {
  assert.equal(parseRequireCopilot('true'), true);
  for (const v of [
    undefined,
    null,
    '',
    'false',
    'TRUE',
    'True',
    '1',
    'yes',
    ' true',
  ])
    assert.equal(parseRequireCopilot(v), false, JSON.stringify(v));
});

test('evaluateGates with the Copilot gate off', () => {
  const off = { ...passing, requireCopilot: false, copilotReviewedHead: false };
  const r = evaluateGates(off);
  assert.equal(r.state, 'success');
  const copilotCheck = r.checks.find((c) => c.key === 'copilot');
  assert.equal(copilotCheck.state, 'success');
  assert.equal(copilotCheck.detail, 'not required (REQUIRE_COPILOT off)');
  // The default is off.
  const { requireCopilot: _drop, ...noFlag } = off;
  assert.equal(evaluateGates(noFlag).state, 'success');
  // The description names only the checks that ran.
  assert.equal(r.description, 'CI and threads all satisfied');
  assert.ok(!/copilot/i.test(r.description));
  assert.match(
    evaluateGates(passing).description,
    /^CI, Copilot review and threads all satisfied$/,
  );
  // Copilot having reviewed anyway changes nothing while it is off.
  assert.equal(
    evaluateGates({ ...off, copilotReviewedHead: true }).state,
    'success',
  );
  // Every other gate still holds.
  const ci = evaluateGates({ ...off, ciConclusion: 'failure' });
  assert.equal(ci.state, 'failure');
  assert.equal(ci.blockedBy, 'ci');
  assert.equal(evaluateGates({ ...off, ciConclusion: null }).state, 'pending');
  const threads = evaluateGates({ ...off, unresolvedThreads: 1 });
  assert.equal(threads.state, 'pending');
  assert.equal(threads.blockedBy, 'threads');
});

test('evaluateApproval with the Copilot gate off goes straight to human approval', () => {
  const base = {
    prState: 'open',
    draft: true,
    labels: ['stage:building'],
    headSha: 'h1',
    ciConclusion: 'success',
    unresolvedThreads: 0,
    copilotReviewedHead: false,
    requireCopilot: false,
    state: emptyState(),
  };
  const done = evaluateApproval(base);
  assert.equal(done.action, 'human-approval');
  assert.equal(done.gates.state, 'success');
  // Never asks for Copilot, however the request state looks.
  assert.notEqual(
    evaluateApproval({
      ...base,
      state: { ...emptyState(), copilotRequestedFor: 'h0' },
    }).action,
    'request-copilot',
  );
  // A missing CI / threads gate still waits or fails as before.
  for (const missing of [
    { ciConclusion: 'failure' },
    { ciConclusion: null },
    { unresolvedThreads: 1 },
  ]) {
    const r = evaluateApproval({ ...base, ...missing });
    assert.equal(r.action, 'wait', JSON.stringify(missing));
    assert.notEqual(r.gates.state, 'success');
  }
  assert.equal(
    evaluateApproval({ ...base, ciConclusion: 'failure' }).gates.state,
    'failure',
  );
  // A protected change still needs the owner's approval of this head.
  const held = evaluateApproval({
    ...base,
    protectedRequired: true,
    protectedApprovalState: 'pending',
  });
  assert.equal(held.action, 'wait');
  assert.equal(held.gates.blockedBy, 'protected-approval');
  assert.equal(held.gates.state, 'pending');
  assert.equal(
    evaluateApproval({
      ...base,
      protectedRequired: true,
      protectedApprovalState: 'success',
    }).action,
    'human-approval',
  );
  // Idempotent once handed off; parked PRs are left alone.
  assert.equal(
    evaluateApproval({
      ...base,
      draft: false,
      labels: ['stage:human-approval'],
      state: { ...emptyState(), humanApprovalFor: 'h1' },
    }).action,
    'noop',
  );
  assert.equal(
    evaluateApproval({ ...base, labels: ['stage:needs-attention'] }).action,
    'noop',
  );
});

test('the state table says "not required" while the Copilot gate is off', () => {
  const s = { ...emptyState(), copilotRequestedFor: 'abcdef1234' };
  assert.match(renderState(s, [], { requireCopilot: false }), /not required/);
  assert.doesNotMatch(
    renderState(s, [], { requireCopilot: true }),
    /not required/,
  );
  assert.match(renderState(s), /`abcdef1`/);
  // The field stays in the data, so old state still parses.
  const back = parseState(renderState(s, [], { requireCopilot: false }));
  assert.equal(back.copilotRequestedFor, 'abcdef1234');
});

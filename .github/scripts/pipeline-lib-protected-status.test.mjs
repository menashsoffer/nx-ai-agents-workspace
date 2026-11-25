// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import {
  protectedOfCompare,
  evaluateProtectedApproval,
  PROTECTED_CONTEXT,
  COMPARE_FILE_LIMIT,
  evaluateGates,
  PROBLEMS,
  HARD_GATES,
  STAGES,
  STAGE_STATUS,
  MARKERS,
  decideByRules,
  parseOutcome,
  renderOutcome,
  isPipelineBranch,
  routerSkip,
  stageTransition,
  branchPushTriggers,
} from './pipeline-lib.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  LOCK,
  OWNER_LOGIN,
  PA,
  PB,
  PKG,
  cf,
  depFiles,
  passing,
  problem,
} from './pipeline-lib-fixtures.mjs';

// ---- the status: approval, invalidation on a new head

const approvedNote = (over = {}) => ({
  issue: 7,
  pr: 9,
  head: PA,
  paths: protectedOfCompare(depFiles()).hash,
  by: OWNER_LOGIN,
  commentId: 55,
  ...over,
});

const evalPr = (over = {}) =>
  evaluateProtectedApproval({
    pipelinePr: true,
    head: PA,
    files: depFiles(),
    notes: [approvedNote()],
    ownerLogin: OWNER_LOGIN,
    ...over,
  });

test('pipeline/protected-approval: success only for the approved head and path set', () => {
  const ok = evalPr();
  assert.equal(ok.state, 'success');
  assert.equal(ok.required, true);
  assert.deepEqual(ok.paths, [LOCK, PKG].sort());
  assert.match(ok.description, /Approved by @menashsoffer/);
  assert.equal(PROTECTED_CONTEXT, 'pipeline/protected-approval');

  // no approval yet: pending, with the command to give
  const pending = evalPr({ notes: [] });
  assert.equal(pending.state, 'pending');
  assert.equal(
    pending.description,
    `Waiting for the owner: /approve-protected ${PA.slice(0, 12)}`,
  );

  // invalidation: any later push is a new head, so the approval no longer holds
  const pushed = evalPr({ head: PB });
  assert.equal(pushed.state, 'pending');
  assert.equal(pushed.required, true);
  // ...the same head with a different protected path set does not hold either
  assert.equal(
    evalPr({ files: [...depFiles(), cf('apps/x/package.json')] }).state,
    'pending',
  );
  assert.equal(evalPr({ files: [cf(PKG)] }).state, 'pending');
  // the latest owner record decides: approve A, then B, back on A is pending
  assert.equal(
    evalPr({ notes: [approvedNote(), approvedNote({ head: PB })] }).state,
    'pending',
  );
  assert.equal(
    evalPr({ notes: [approvedNote({ head: PB }), approvedNote()] }).state,
    'success',
  );
  // a record that is not the owner's does not count; without an owner none does
  assert.equal(
    evalPr({ notes: [approvedNote({ by: 'mallory' })] }).state,
    'pending',
  );
  assert.equal(evalPr({ ownerLogin: '' }).state, 'pending');
  assert.equal(evalPr({ ownerLogin: undefined }).state, 'pending');
});

test('pipeline/protected-approval: automatic success, and failure for what cannot be approved', () => {
  // no protected path: success automatically, not required
  const none = evalPr({ files: [cf('apps/site/a.ts')], notes: [] });
  assert.equal(none.state, 'success');
  assert.equal(none.required, false);
  assert.deepEqual(none.paths, []);
  // not a pipeline PR (a person's own, Dependabot): the code owner reviews it
  const human = evalPr({ pipelinePr: false, files: depFiles(), notes: [] });
  assert.equal(human.state, 'success');
  assert.equal(human.required, false);
  assert.match(human.description, /Not a pipeline PR/);
  // a never-approvable path on a pipeline PR fails hard
  const never = evalPr({
    files: [...depFiles(), cf('.github/workflows/ci.yml')],
  });
  assert.equal(never.state, 'failure');
  assert.match(never.description, /\.github\/workflows\/ci\.yml/);
  // a file list that may be cut off cannot be trusted
  const cut = evalPr({
    files: Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) => cf(`f${i}.ts`)),
  });
  assert.equal(cut.state, 'failure');
  // statuses are at most 140 characters
  for (const r of [evalPr(), evalPr({ notes: [] }), never, cut])
    assert.ok(r.description.length <= 140, r.description);
});

test('gates take the recomputed protected approval: a push after approval blocks the merge', () => {
  const gatesFor = (evaluation) =>
    evaluateGates({
      ...passing,
      protectedRequired: evaluation.required,
      protectedApprovalState: evaluation.state,
    });
  assert.equal(gatesFor(evalPr()).state, 'success');
  const stale = gatesFor(evalPr({ head: PB }));
  assert.equal(stale.state, 'pending');
  assert.equal(stale.blockedBy, 'protected-approval');
  assert.equal(
    gatesFor(evalPr({ files: [cf('a.ts')], notes: [] })).state,
    'success',
  );
  assert.equal(
    gatesFor(evalPr({ files: [cf('.github/x.yml')] })).state,
    'failure',
  );
});

// ---- fix.yml, router, stages

test('the new problems, stage and rules', () => {
  assert.ok(PROBLEMS.includes('protected_approval_needed'));
  assert.ok(PROBLEMS.includes('protected_rejected'));
  assert.ok(HARD_GATES.includes('protected_approval_needed'));
  assert.ok(!HARD_GATES.includes('protected_rejected'));
  assert.ok(STAGES.includes('stage:awaiting-approval'));
  assert.equal(STAGE_STATUS['stage:awaiting-approval'], 'Awaiting approval');
  for (const stage of STAGES) assert.ok(STAGE_STATUS[stage], stage);
  assert.ok(MARKERS.protectedApproval && MARKERS.protectedApproved);
  // a rejection goes to a human, and stays one round in the rules table
  assert.equal(
    decideByRules({ outcome: problem('develop', 'protected_rejected') }).target,
    'human',
  );
  // the outcome notes round-trip
  for (const p of ['protected_approval_needed', 'protected_rejected'])
    assert.equal(
      parseOutcome(renderOutcome(problem('develop', p))).ok,
      true,
      p,
    );
  // the request outcome never routes: the hard gate says human anyway
  assert.equal(
    decideByRules({ outcome: problem('develop', 'protected_approval_needed') })
      .target,
    'human',
  );
  assert.ok(isPipelineBranch('issue-7-add-dep'));
  assert.ok(!isPipelineBranch('main'));
  assert.ok(!isPipelineBranch('issue-7-'));
});

test('the router never moves an item out of stage:awaiting-approval', () => {
  const labels = (...names) => names.map((name) => ({ name }));
  assert.match(
    routerSkip({
      number: 7,
      state: 'open',
      labels: labels('stage:awaiting-approval'),
    }),
    /awaiting the owner's approval/,
  );
  assert.equal(
    routerSkip({
      number: 7,
      state: 'open',
      labels: ['stage:awaiting-approval'],
    }) !== null,
    true,
  );
  assert.equal(
    routerSkip({ number: 7, state: 'open', labels: labels('stage:routing') }),
    null,
  );
  assert.equal(routerSkip({ number: 7, state: 'open' }), null);
  // an ordinary stage change removes it (one stage label at a time)
  assert.deepEqual(
    stageTransition(['stage:awaiting-approval'], 'stage:building'),
    {
      add: ['stage:building'],
      remove: ['stage:awaiting-approval'],
    },
  );
});

// ---- the push-trigger guard

test('branchPushTriggers: which workflows a branch push would fire', () => {
  const b = 'issue-7-add-dep';
  const fires = (on) => branchPushTriggers(on, b);
  assert.deepEqual(fires({ push: { branches: ['main'] } }), []);
  assert.deepEqual(fires({ push: { branches: ['main', 'release/**'] } }), []);
  assert.deepEqual(fires({ push: null }), ['push']);
  assert.deepEqual(fires({ push: {} }), ['push']);
  assert.deepEqual(fires('push'), ['push']);
  assert.deepEqual(fires(['pull_request', 'push']), ['push']);
  assert.deepEqual(fires({ push: { branches: ['**'] } }), ['push']);
  assert.deepEqual(fires({ push: { branches: ['*'] } }), ['push']);
  assert.deepEqual(fires({ push: { branches: ['issue-*'] } }), ['push']);
  assert.deepEqual(fires({ push: { branches: ['issue-**'] } }), ['push']);
  assert.deepEqual(fires({ push: { branches: ['issue-7-*'] } }), ['push']);
  // a negation excludes the branch again
  assert.deepEqual(fires({ push: { branches: ['**', '!issue-*'] } }), []);
  assert.deepEqual(fires({ push: { branches: ['!issue-*', '**'] } }), ['push']);
  assert.deepEqual(fires({ push: { 'branches-ignore': ['issue-*'] } }), []);
  assert.deepEqual(fires({ push: { 'branches-ignore': ['docs/**'] } }), [
    'push',
  ]);
  // tags only: a branch push does not fire it
  assert.deepEqual(fires({ push: { tags: ['v*'] } }), []);
  assert.deepEqual(fires({ push: { tags: ['v*'], branches: ['**'] } }), [
    'push',
  ]);
  // a branch being created fires `create`, a filter cannot stop it
  assert.deepEqual(fires({ create: null }), ['create']);
  assert.deepEqual(fires(['create']), ['create']);
  assert.deepEqual(
    fires({ pull_request: { types: ['opened'] }, workflow_dispatch: null }),
    [],
  );
  assert.deepEqual(fires(undefined), []);
});

test('push guard: no workflow runs on a push of an issue-<n>-<slug> branch', () => {
  // The approval flow pushes such a branch with no PR, so protected content
  // must not meet secrets before the owner approved it. Every workflow's
  // `on:` is checked for a branch named like the pipeline's.
  const dir = new URL('../workflows/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 10, 'found the workflows');
  for (const file of files) {
    const wf = parseYaml(readFileSync(new URL(file, dir), 'utf8'));
    // YAML 1.1 readers turn a bare `on` key into `true`
    const on = wf.on ?? wf[true];
    assert.ok(on, `${file} has triggers`);
    for (const branch of [
      'issue-1-x',
      'issue-7-add-a-dependency',
      'issue-123-task',
    ])
      assert.deepEqual(
        branchPushTriggers(on, branch),
        [],
        `${file} would run on a push of ${branch}`,
      );
  }
  // deploy.yml is the only push trigger, and it is limited to the default branch
  const deploy = parseYaml(readFileSync(new URL('deploy.yml', dir), 'utf8'));
  assert.deepEqual((deploy.on ?? deploy[true]).push.branches, ['main']);
});

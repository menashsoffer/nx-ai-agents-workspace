// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  stageTransition,
  applyLabels,
  STAGES,
  STAGE_STATUS,
  clearStages,
  issueFromBranch,
  branchIssueEligible,
  planPrClosed,
  PROBLEMS,
  OUTCOME_STAGES,
  HARD_GATES,
  allowedTargets,
  prClosedOutcome,
  normalizeOutcome,
  renderOutcome,
  planRoute,
  routerSkip,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOT, bot } from './pipeline-lib-fixtures.mjs';

// ---------------------------------------------------------------- done.yml

test('merged: stage:done replaces every stage:* label', () => {
  const labels = ['bug', 'stage:human-approval'];
  const edit = stageTransition(labels, 'stage:done');
  assert.deepEqual(edit, {
    add: ['stage:done'],
    remove: ['stage:human-approval'],
  });
  assert.deepEqual(applyLabels(labels, edit), ['bug', 'stage:done']);
  assert.deepEqual(stageTransition(['stage:done'], 'stage:done'), {
    add: [],
    remove: [],
  });
  assert.ok(STAGES.includes('stage:done'));
  assert.equal(STAGE_STATUS['stage:done'], 'Done');
});

test('closed unmerged: clearStages leaves no stage', () => {
  const labels = ['bug', 'stage:human-approval'];
  assert.deepEqual(applyLabels(labels, clearStages(labels)), ['bug']);
  assert.deepEqual(clearStages(['bug']), { add: [], remove: [] });
});

test('issueFromBranch: same-repo issue-<n>- branches only', () => {
  const repo = 'o/r';
  const at = (headRef, headRepo = repo) =>
    issueFromBranch({ headRef, headRepo, repo });
  assert.equal(at('issue-14-add-footer'), 14);
  assert.equal(at('issue-7-task'), 7);
  assert.equal(at('issue-14-x', 'O/R'), 14, 'repo names are case-insensitive');
  assert.equal(at('issue-14-x', 'fork/r'), null, 'forks never count');
  assert.equal(at('issue-14-x', null), null);
  for (const ref of ['issue-0-x', 'issue-14', 'issue-x-14', 'feat/issue-14-x'])
    assert.equal(at(ref), null, ref);
  assert.equal(at('dependabot/npm_and_yarn/vite-8.0.1'), null);
});

test('branchIssueEligible: open, or closed by this merge', () => {
  const mergedAt = '2026-09-01T12:00:00Z';
  const ok = (issue, merged = true) =>
    branchIssueEligible({ issue, merged, mergedAt });
  assert.ok(ok({ state: 'open' }));
  assert.ok(ok({ state: 'open' }, false));
  assert.ok(ok({ state: 'closed', closed_at: '2026-09-01T12:00:03Z' }));
  assert.ok(!ok({ state: 'closed', closed_at: '2026-08-01T00:00:00Z' }));
  assert.ok(!ok({ state: 'closed', closed_at: '2026-09-01T12:00:03Z' }, false));
  assert.ok(!ok({ state: 'open', pull_request: {} }), 'a PR is not an issue');
  assert.ok(!ok(null), 'no such issue');
});

test('planPrClosed: merged -> stage:done for the PR and every issue', () => {
  const plan = planPrClosed({
    pr: { number: 19, merged: true, labels: ['stage:building'] },
    issues: [
      { number: 14, state: 'closed' },
      { number: 15, state: 'open' },
    ],
  });
  assert.equal(plan.act, true);
  assert.deepEqual(plan.pr, { number: 19, labels: 'done' });
  assert.deepEqual(
    plan.issues.map((i) => [i.number, i.action]),
    [
      [14, 'done'],
      [15, 'done'],
    ],
  );
  // A manual or Dependabot PR: not a pipeline item.
  assert.equal(
    planPrClosed({ pr: { number: 3, merged: true, labels: [] }, issues: [] })
      .act,
    false,
  );
  // A pipeline PR whose issue link was removed still finishes.
  assert.equal(
    planPrClosed({
      pr: { number: 3, merged: true, labels: ['stage:human-approval'] },
      issues: [],
    }).act,
    true,
  );
});

test('planPrClosed: closed unmerged routes open issues without a replacement PR', () => {
  const plan = planPrClosed({
    pr: { number: 19, merged: false, labels: ['stage:human-approval'] },
    issues: [
      { number: 14, state: 'open', openPrs: [19] },
      { number: 15, state: 'open', openPrs: [19, 22] },
      { number: 16, state: 'closed', openPrs: [] },
    ],
  });
  assert.equal(plan.act, true);
  assert.deepEqual(plan.pr, { number: 19, labels: 'clear' });
  assert.deepEqual(
    plan.issues.map((i) => [i.number, i.action, i.reason]),
    [
      [14, 'route', 'no open PR left'],
      [15, 'skip', 'replacement PR #22 is open'],
      [16, 'skip', 'issue is closed'],
    ],
  );
  const none = planPrClosed({
    pr: { number: 5, merged: false, labels: ['stage:building'] },
    issues: [],
  });
  assert.equal(none.act, false, 'no linked issue: nothing');
});

test('pr_closed: a problem code, noted on the issue, routed only to a human', () => {
  assert.ok(PROBLEMS.includes('pr_closed'));
  assert.ok(OUTCOME_STAGES.includes('pr'));
  assert.ok(!HARD_GATES.includes('pr_closed'));
  assert.deepEqual(allowedTargets('pr', 'pr_closed'), ['human']);
  for (const stage of OUTCOME_STAGES)
    assert.deepEqual(allowedTargets(stage, 'pr_closed'), ['human'], stage);

  const input = prClosedOutcome({ pr: 19, closedBy: 'alice' });
  const o = normalizeOutcome({ ...input, item: 14 });
  assert.equal(o.stage, 'pr');
  assert.equal(o.result, 'problem');
  assert.equal(o.problem, 'pr_closed');
  assert.match(o.summary, /PR #19 was closed without merging/);
  assert.match(o.details[0], /PR #19 was closed by `alice`/);
  assert.match(
    prClosedOutcome({ pr: 19, closedBy: '<!-- x' }).details[0],
    /an unknown user/,
  );

  // Router: the note goes to a human, and can never be retried.
  const comments = [{ user: bot, body: renderOutcome(o) }];
  const r = planRoute({ comments, botLogin: BOT });
  assert.equal(r.final.target, 'human');
  assert.equal(r.stage, 'stage:needs-attention');
  assert.match(r.body, /closed without merging/);
  const external = planRoute({
    comments,
    botLogin: BOT,
    mode: 'external',
    external: { target: 'redevelop', confidence: 0.99 },
  });
  assert.equal(external.final.target, 'human');
});

test('routerSkip: closed items are never routed; open ones are', () => {
  assert.equal(routerSkip({ number: 14, state: 'closed' }), '#14 is closed');
  assert.equal(routerSkip({ number: 14, state: 'open' }), null);
});

test('workflows: closed items cannot leave Done, and the router skips them', () => {
  const read = (f) =>
    readFileSync(new URL(`../workflows/${f}`, import.meta.url), 'utf8');
  const guard =
    "((github.event.issue.state || github.event.pull_request.state) != 'closed' || github.event.label.name == 'stage:done')";
  assert.ok(read('project-sync.yml').includes(guard));
  const router = read('router.yml');
  const open =
    "(github.event.issue.state || github.event.pull_request.state) == 'open'";
  assert.equal(router.split(open).length - 1, 2, 'brain and route jobs');
  const done = read('done.yml');
  assert.ok(!done.includes('pull_request_target'));
  assert.ok(done.includes('sparse-checkout: .github/scripts'));
  assert.ok(
    done.includes(
      'github.event.pull_request.head.repo.full_name == github.repository',
    ),
  );
});

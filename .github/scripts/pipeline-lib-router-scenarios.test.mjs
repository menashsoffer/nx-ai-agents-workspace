// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import {
  planRoute,
  LEGACY_ROUTE_TARGETS,
  parseRoute,
  parseOutcome,
  renderOutcome,
  collectRouterInput,
  ROUTE_TARGETS,
  TARGET_STAGE,
  STAGES,
  STAGE_STATUS,
} from './pipeline-lib.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT, note, outcomeNote } from './pipeline-lib-fixtures.mjs';

// Scenario walk-throughs (also described in the router PR).
function simulate(steps) {
  const comments = [];
  const results = [];
  for (const [stage, p, extra] of steps) {
    comments.push(outcomeNote(stage, p, extra));
    const r = planRoute({ comments, botLogin: BOT });
    comments.push(note(r.body));
    results.push(r);
  }
  return results;
}

test('scenario: spec_questions -> human immediately, no loop used', () => {
  const [a, next] = simulate([
    ['plan', 'spec_questions', { questions: ['Which page?'] }],
    // after the human restarts, the budget is untouched
    ['plan', 'invalid_output'],
  ]);
  assert.deepEqual(
    [a.final.target, a.stage, a.final.round],
    ['human', 'stage:needs-attention', 0],
  );
  assert.match(a.body, /the issue is unclear/);
  assert.ok(a.body.includes('- Which page?'), 'open questions are listed');
  assert.equal(next.final.target, 'replan');
  assert.equal(next.final.round, 1);
});

test('scenario: invalid_output x3 -> re-plan, re-plan, human (cap 2)', () => {
  const [a, b, c] = simulate([
    ['plan', 'invalid_output'],
    ['plan', 'agent_error'],
    ['plan', 'invalid_output'],
  ]);
  assert.deepEqual(
    [a, b, c].map((r) => [r.final.target, r.stage, r.final.round]),
    [
      ['replan', 'stage:qualified', 1],
      ['replan', 'stage:qualified', 2],
      ['human', 'stage:needs-attention', 2],
    ],
  );
  assert.match(c.body, /cap is reached \(2\/2\)/);
});

test('scenario: scope_split (too big) -> human immediately', () => {
  const [r] = simulate([['plan', 'scope_split', { details: ['12 files'] }]]);
  assert.equal(r.final.target, 'human');
  assert.equal(r.stage, 'stage:needs-attention');
  assert.match(r.final.reason, /too big/);
  assert.equal(r.final.round, 0);
});

test('scenario: spec agent_error -> human without using a loop', () => {
  const [r, next] = simulate([
    ['spec', 'agent_error'],
    // after the human restarts, the budget is untouched
    ['spec', 'invalid_output'],
  ]);
  assert.equal(r.final.target, 'human');
  assert.match(r.body, /the old spec stage failed/);
  assert.equal(next.final.target, 'replan');
  assert.equal(next.final.round, 1);
});

// Issue history written before the merge of spec + plan must still work.
const legacyRoute = (round = 1) =>
  note(
    [
      `<!-- pipeline:route target=respec round=${round} -->`,
      '**Routed to re-spec (`stage:qualified`), round 1/2, because:** the planner needs a better spec',
      '',
      '```json',
      JSON.stringify({
        v: 1,
        from_stage: 'plan',
        problem: 'spec_questions',
        target: 'respec',
        reason: 'the planner needs a better spec',
        round,
        cap: 2,
        mode: 'rules',
        external: null,
        questions: ['Which page?'],
      }),
      '```',
    ].join('\n'),
  );

test('old notes: spec-stage outcomes and respec routes still parse', () => {
  assert.deepEqual(LEGACY_ROUTE_TARGETS, { respec: 'replan' });
  const r = parseRoute(legacyRoute().body);
  assert.equal(r.ok, true);
  assert.equal(r.route.target, 'replan');
  assert.equal(r.route.from_stage, 'plan');
  assert.deepEqual(r.route.questions, ['Which page?']);
  // a mismatch between header and json is still rejected
  assert.equal(
    parseRoute(legacyRoute().body.replace('target=respec', 'target=replan')).ok,
    false,
  );
  // an old spec-stage outcome note parses (stage, problem and all)
  for (const [stage, p] of [
    ['spec', 'invalid_output'],
    ['spec', 'agent_error'],
    ['plan', 'spec_missing'],
    ['plan', 'untestable_criteria'],
  ]) {
    const parsed = parseOutcome(
      renderOutcome({ stage, result: 'problem', problem: p }),
    );
    assert.equal(parsed.ok, true, `${stage}/${p}`);
    assert.deepEqual(
      [parsed.outcome.stage, parsed.outcome.problem],
      [stage, p],
    );
  }
  // legacy respec routes count against the (shared) re-plan budget
  const input = collectRouterInput({
    comments: [
      outcomeNote('plan', 'spec_questions'),
      legacyRoute(1),
      outcomeNote('spec', 'invalid_output'),
      legacyRoute(2),
      outcomeNote('spec', 'invalid_output'),
    ],
    botLogin: BOT,
  });
  assert.deepEqual(
    input.history.routes.map((x) => x.target),
    ['replan', 'replan'],
  );
  // ...so a third one is capped, and an old spec note is still routed
  const routed = planRoute({
    comments: [
      outcomeNote('plan', 'spec_questions'),
      legacyRoute(1),
      outcomeNote('spec', 'invalid_output'),
      legacyRoute(2),
      outcomeNote('spec', 'invalid_output'),
    ],
    botLogin: BOT,
  });
  assert.equal(routed.final.target, 'human');
  assert.match(routed.final.reason, /cap is reached \(2\/2\)/);
  const fresh = planRoute({
    comments: [outcomeNote('spec', 'invalid_output')],
    botLogin: BOT,
  });
  assert.deepEqual(
    [fresh.final.target, fresh.stage],
    ['replan', 'stage:qualified'],
  );
  // an old plan-stage spec_questions note goes to a human now
  assert.equal(
    planRoute({
      comments: [outcomeNote('plan', 'spec_questions')],
      botLogin: BOT,
    }).final.target,
    'human',
  );
});

test('no route decision targets respec or stage:spec any more', () => {
  assert.ok(!ROUTE_TARGETS.includes('respec'));
  assert.ok(!Object.values(TARGET_STAGE).includes('stage:spec'));
  assert.equal(TARGET_STAGE.replan, 'stage:qualified');
  // deprecated but still a known stage, so old items keep their board column
  assert.ok(STAGES.includes('stage:spec'));
  assert.equal(STAGE_STATUS['stage:spec'], 'Spec');
});

// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import { test } from 'node:test';
import {
  decideByRules,
  allowedTargets,
  clampDecision,
  OUTCOME_STAGES,
  PROBLEMS,
  targetStage,
  STAGES,
  ROUTER_CAPS,
  HARD_GATES,
  chooseDecision,
  planRoute,
  collectRouterInput,
  renderOutcome,
  renderRoute,
  parseRoute,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import {
  BOT,
  note,
  outcomeNote,
  problem,
  routeNote,
} from './pipeline-lib-fixtures.mjs';

const RULE_ROWS = [
  // legacy spec-stage notes still route
  ['spec', 'invalid_output', 'replan'],
  ['spec', 'agent_error', 'human'],
  // legacy plan-stage problems that nothing emits any more
  ['plan', 'spec_missing', 'replan'],
  ['plan', 'untestable_criteria', 'replan'],
  ['plan', 'spec_questions', 'human'],
  ['plan', 'scope_split', 'human'],
  ['plan', 'agent_error', 'replan'],
  ['plan', 'invalid_output', 'replan'],
  ['develop', 'verify_failed', 'redevelop'],
  ['develop', 'agent_error', 'redevelop'],
  ['develop', 'plan_gap', 'replan'],
  ['develop', 'protected_rejected', 'human'],
  ['approval', 'copilot_request_failed', 'human'],
  ['plan', 'verify_failed', 'human'], // no rule
  ['approval', 'agent_error', 'human'], // no rule
];

test('decideByRules: every rules-table row', () => {
  for (const [stage, p, target] of RULE_ROWS) {
    const outcome = problem(stage, p, { questions: ['q'] });
    const d = decideByRules({ outcome, history: {}, labels: [] });
    assert.equal(d.target, target, `${stage}/${p}`);
    assert.deepEqual(d.questions, ['q']);
    assert.ok(allowedTargets(stage, p).includes(target));
    assert.ok(allowedTargets(stage, p).includes('human'));
    const final = clampDecision({ decision: d, outcome, history: {} });
    assert.equal(final.target, target, `${stage}/${p} clamped`);
  }
  assert.match(
    decideByRules({ outcome: problem('spec', 'agent_error') }).reason,
    /the old spec stage failed/,
  );
  assert.equal(decideByRules({ outcome: null }).target, 'human');
});

test('no decision ever targets stage:routing', () => {
  const targets = new Set();
  for (const stage of OUTCOME_STAGES)
    for (const p of PROBLEMS.filter((x) => x !== 'none')) {
      const outcome = problem(stage, p);
      for (const t of allowedTargets(stage, p)) targets.add(targetStage(t));
      const final = clampDecision({
        decision: decideByRules({ outcome }),
        outcome,
      });
      targets.add(targetStage(final.target));
    }
  assert.ok(!targets.has('stage:routing'));
  for (const t of targets) assert.ok(STAGES.includes(t), t);
});

test('caps: each target and the global cap send work to a human', () => {
  const route = (target) => ({ target, questions: [] });
  for (const [stage, p, target] of [
    ['plan', 'agent_error', 'replan'],
    ['develop', 'verify_failed', 'redevelop'],
  ]) {
    const outcome = problem(stage, p);
    const decision = decideByRules({ outcome });
    const cap = ROUTER_CAPS[target];
    const under = clampDecision({
      decision,
      outcome,
      history: { routes: Array(cap - 1).fill(route(target)) },
    });
    assert.equal(under.target, target);
    assert.equal(under.round, cap);
    const over = clampDecision({
      decision,
      outcome,
      history: { routes: Array(cap).fill(route(target)) },
    });
    assert.equal(over.target, 'human', target);
    assert.match(over.reason, /cap is reached/);
  }
  // the re-plan budget is shared by every row that re-plans
  assert.equal(ROUTER_CAPS.replan, 2);
  assert.equal(ROUTER_CAPS.global, 5);
  assert.ok(!('respec' in ROUTER_CAPS));
  const shared = clampDecision({
    decision: { target: 'replan', reason: 'r' },
    outcome: problem('develop', 'plan_gap'),
    history: { routes: [route('replan'), route('replan')] },
  });
  assert.equal(shared.target, 'human');
  // global cap
  const global = clampDecision({
    decision: { target: 'replan', reason: 'r' },
    outcome: problem('plan', 'agent_error'),
    history: { routes: Array(5).fill(route('replan')) },
    caps: { ...ROUTER_CAPS, replan: 9 },
  });
  assert.equal(global.target, 'human');
  assert.match(global.reason, /global cap/);
  // a route to a human does NOT open a fresh window (only a restart does)
  const routes = [route('replan'), route('replan'), route('human')];
  const spent = clampDecision({
    decision: { target: 'replan', reason: 'r' },
    outcome: problem('plan', 'agent_error'),
    history: { routes },
  });
  assert.equal(spent.target, 'human');
  assert.match(spent.reason, /cap is reached \(2\/2\)/);
  const fresh = clampDecision({
    decision: { target: 'replan', reason: 'r' },
    outcome: problem('plan', 'agent_error'),
    history: { routes: [...routes, { target: 'restart' }] },
  });
  assert.equal(fresh.target, 'replan');
  assert.equal(fresh.round, 1);
});

test('redevelop is unsafe while an open PR exists', () => {
  const outcome = problem('develop', 'verify_failed');
  const final = clampDecision({
    decision: decideByRules({ outcome }),
    outcome,
    facts: { openPullRequest: true },
  });
  assert.equal(final.target, 'human');
});

test('hard gates beat rules, external picks and caps', () => {
  for (const gate of HARD_GATES)
    for (const stage of ['plan', 'develop', 'approval']) {
      const outcome = problem(stage, gate);
      assert.deepEqual(allowedTargets(stage, gate), ['human']);
      assert.equal(decideByRules({ outcome }).target, 'human');
      const chosen = chooseDecision({
        mode: 'external',
        rules: decideByRules({ outcome }),
        external: { target: 'replan', confidence: 0.99 },
        allowed: ['replan', 'human'], // even if a caller got this wrong
      });
      assert.equal(chosen.decision.target, 'replan');
      const final = clampDecision({ decision: chosen.decision, outcome });
      assert.equal(final.target, 'human', `${stage}/${gate}`);
      assert.match(final.reason, /hard gate/);
    }
});

test('external picks: used only when allowed and confident', () => {
  const outcome = problem('plan', 'agent_error');
  const rules = decideByRules({ outcome });
  const allowed = allowedTargets('plan', 'agent_error');
  const pick = (target, confidence) =>
    chooseDecision({
      mode: 'external',
      rules,
      external: { target, confidence },
      allowed,
    });
  const yes = pick('human', 0.9);
  assert.equal(yes.decision.target, 'human');
  assert.equal(yes.external.accepted, true);
  assert.equal(pick('redevelop', 0.99).decision.target, 'replan');
  assert.match(pick('redevelop', 0.99).decision.reason, /not allowed/);
  assert.equal(pick('human', 0.79).decision.target, 'replan');
  assert.equal(pick('human', 0.79).external.accepted, false);
  const none = chooseDecision({
    mode: 'external',
    rules,
    external: null,
    allowed,
  });
  assert.equal(none.decision.target, 'replan');
  assert.equal(none.external, null);
  const junk = chooseDecision({
    mode: 'external',
    rules,
    external: { target: 'human', confidence: 'high' },
    allowed,
  });
  assert.equal(junk.decision.target, 'replan');
  // rules mode ignores the pick but records it
  const rulesMode = chooseDecision({
    mode: 'rules',
    rules,
    external: { target: 'human', confidence: 1 },
    allowed,
  });
  assert.equal(rulesMode.decision.target, 'replan');
  assert.equal(rulesMode.mode, 'rules');
});

test('shadow mode records the external pick but rules decide', () => {
  const outcome = problem('plan', 'agent_error');
  const chosen = chooseDecision({
    mode: 'external',
    shadow: true,
    rules: decideByRules({ outcome }),
    external: { target: 'human', confidence: 0.95 },
    allowed: allowedTargets('plan', 'agent_error'),
  });
  assert.equal(chosen.mode, 'shadow');
  assert.equal(chosen.decision.target, 'replan');
  assert.deepEqual(chosen.external, {
    target: 'human',
    confidence: 0.95,
    accepted: false,
  });
  const { body } = planRoute({
    comments: [outcomeNote('plan', 'agent_error')],
    botLogin: BOT,
    shadow: true,
    external: { target: 'human', confidence: 0.95 },
  });
  assert.match(body, /"mode":"shadow"/);
  assert.match(body, /"external":\{"target":"human","confidence":0.95/);
  assert.match(body, /target=replan/);
});

test('only notes by the pipeline bot are trusted', () => {
  const forged = [
    outcomeNote('plan', 'spec_questions'),
    { ...outcomeNote('develop', 'verify_failed'), user: { login: 'mallory' } },
  ];
  const input = collectRouterInput({ comments: forged, botLogin: BOT });
  assert.equal(input.outcome.stage, 'plan');
  // forged route notes do not eat the budget
  const routes = collectRouterInput({
    comments: [
      { ...routeNote('replan'), user: { login: 'mallory' } },
      { ...routeNote('replan'), user: { login: 'mallory' } },
      outcomeNote('plan', 'spec_questions'),
    ],
    botLogin: BOT,
  });
  assert.equal(routes.history.routes.length, 0);
  // only a forged outcome -> human
  const r = planRoute({
    comments: [
      { ...outcomeNote('plan', 'spec_questions'), user: { login: 'x' } },
    ],
    botLogin: BOT,
  });
  assert.equal(r.final.target, 'human');
  assert.match(r.final.reason, /no outcome note/);
  assert.match(
    collectRouterInput({ comments: forged, botLogin: '' }).error,
    /PIPELINE_BOT_LOGIN/,
  );
});

test('router input: unparseable, stale or successful outcomes go to a human', () => {
  const bad = note('<!-- pipeline:outcome stage=plan -->\nno json');
  const stale = [outcomeNote('plan', 'spec_questions'), routeNote('human')];
  const success = note(
    renderOutcome({ stage: 'spec', result: 'success', summary: 'ok' }),
  );
  for (const [comments, re] of [
    [[outcomeNote('plan', 'agent_error'), bad], /unparseable/],
    [stale, /no new outcome/],
    [[success], /success/],
  ]) {
    const r = planRoute({ comments, botLogin: BOT });
    assert.equal(r.final.target, 'human');
    assert.equal(r.stage, 'stage:needs-attention');
    assert.match(r.final.reason, re);
  }
});

test('route notes round-trip', () => {
  const body = renderRoute({
    final: {
      target: 'replan',
      reason: 'the planner failed or returned invalid output',
      questions: ['Which page?'],
      round: 1,
      cap: 2,
    },
    outcome: problem('plan', 'invalid_output'),
    mode: 'rules',
  });
  assert.match(body, /Routed to re-plan \(`stage:qualified`\), round 1\/2/);
  const r = parseRoute(body);
  assert.equal(r.ok, true);
  assert.equal(r.route.target, 'replan');
  assert.equal(r.route.from_stage, 'plan');
  assert.deepEqual(r.route.questions, ['Which page?']);
  assert.equal(
    parseRoute(body.replace('"target":"replan"', '"target":"deploy"')).ok,
    false,
  );
});

// pipeline-lib/router: one concern of the pipeline decision logic (see ../pipeline-lib.mjs).
import {
  EXTERNAL_MIN_CONFIDENCE,
  LEGACY_ROUTE_TARGETS,
  ROUTER_CAPS,
  ROUTE_TARGETS,
  allowedTargets,
  decideByRules,
  routeWindow,
  targetStage,
} from './router-rules.mjs';
import {
  HARD_GATES,
  OUTCOME_STAGES,
  OUTCOME_VERSION,
  PROBLEMS,
  PROBLEM_TEXT,
  attrs,
  clean,
  cleanList,
  lastJsonFence,
  parseOutcome,
} from './outcomes.mjs';
import { MARKERS } from './constants.mjs';
import { parseRestartNote } from './restart.mjs';
import { MAX_LIFETIME_RESETS } from './state.mjs';

/**
 * Caps and hard gates, applied after any brain. Nothing bypasses this.
 * `facts.openPullRequest`: an open PR already exists for the issue's
 * branch; develop.yml then publishes nothing, so re-develop is unsafe.
 */
export function clampDecision({
  decision,
  outcome,
  history = {},
  caps = ROUTER_CAPS,
  facts = {},
}) {
  const window = routeWindow(history.routes);
  const questions = decision?.questions ?? outcome?.questions ?? [];
  const human = (reason, clamped = true) => ({
    target: 'human',
    reason,
    questions,
    round: window.length,
    cap: caps.global,
    clamped,
  });
  if (!outcome || outcome.result !== 'problem')
    return human(decision?.reason ?? 'no problem to route');
  if (HARD_GATES.includes(outcome.problem))
    return human(`hard gate: ${PROBLEM_TEXT[outcome.problem]}`);
  const target = decision?.target;
  const allowed = allowedTargets(outcome.stage, outcome.problem);
  if (!allowed.includes(target))
    return human(
      `"${target}" is not an allowed target for ${outcome.stage}/${outcome.problem}`,
    );
  if (target === 'human') return human(decision.reason, false);
  if (window.length >= caps.global)
    return human(
      `wanted ${TARGET_TEXT[target]}, but the global cap is reached (${window.length}/${caps.global} routed rounds)`,
    );
  const used = window.filter((r) => r.target === target).length;
  if (used >= caps[target])
    return human(
      `wanted ${TARGET_TEXT[target]}, but its cap is reached (${used}/${caps[target]})`,
    );
  if (target === 'redevelop' && facts.openPullRequest)
    return human(
      'wanted re-develop, but an open PR already exists for this issue (develop.yml would publish nothing)',
    );
  return {
    target,
    reason: decision.reason,
    questions,
    round: used + 1,
    cap: caps[target],
    clamped: false,
  };
}

/**
 * Picks between the rules and an external brain. Shadow mode (or any mode
 * but `external`) only records the external pick. In `external` mode the
 * pick is used only if it is allowed and confident; otherwise rules decide.
 * The result still goes through clampDecision.
 */
export function chooseDecision({ mode, shadow, rules, external, allowed }) {
  const pick =
    external &&
    typeof external.target === 'string' &&
    typeof external.confidence === 'number' &&
    Number.isFinite(external.confidence)
      ? { target: external.target, confidence: external.confidence }
      : null;
  const record = pick ? { ...pick, accepted: false } : null;
  if (shadow || mode !== 'external')
    return {
      decision: rules,
      mode: shadow ? 'shadow' : 'rules',
      external: record,
    };
  if (
    pick &&
    allowed.includes(pick.target) &&
    pick.confidence >= EXTERNAL_MIN_CONFIDENCE
  )
    return {
      decision: {
        target: pick.target,
        reason: `external brain chose ${TARGET_TEXT[pick.target] ?? pick.target} (p=${pick.confidence})`,
        questions: rules.questions,
      },
      mode: 'external',
      external: { ...record, accepted: true },
    };
  const why = !pick
    ? 'no external pick'
    : !allowed.includes(pick.target)
      ? `external pick "${pick.target}" is not allowed`
      : `external confidence ${pick.confidence} < ${EXTERNAL_MIN_CONFIDENCE}`;
  return {
    decision: { ...rules, reason: `${rules.reason} (rules; ${why})` },
    mode: 'external',
    external: record,
  };
}

/** Strictly parses a route note. */
export function parseRoute(body) {
  const text = String(body ?? '');
  const header = /^<!-- pipeline:route ([^\n]*?) -->\n/.exec(text);
  if (!header) return { ok: false, error: 'not a route note' };
  const { value: r, error } = lastJsonFence(text);
  if (error) return { ok: false, error };
  if (!r || r.v !== OUTCOME_VERSION)
    return { ok: false, error: 'unsupported version' };
  const target = Object.hasOwn(LEGACY_ROUTE_TARGETS, r.target)
    ? LEGACY_ROUTE_TARGETS[r.target]
    : r.target;
  if (!ROUTE_TARGETS.includes(target) || attrs(header[1]).target !== r.target)
    return { ok: false, error: `bad target ${r.target}` };
  if (!Number.isInteger(r.round) || r.round < 0)
    return { ok: false, error: 'bad round' };
  return {
    ok: true,
    route: {
      target,
      round: r.round,
      from_stage: OUTCOME_STAGES.includes(r.from_stage) ? r.from_stage : null,
      problem: PROBLEMS.includes(r.problem) ? r.problem : null,
      reason: clean(r.reason),
      questions: cleanList(r.questions),
    },
  };
}

/**
 * Reads the router's input from an item's comments (oldest first). Only
 * notes authored by `botLogin` count: the repo is public and anyone can
 * comment. The latest outcome note must parse and be newer than the latest
 * route note; otherwise `error` says why and the router goes to a human.
 */
export function collectRouterInput({ comments = [], botLogin }) {
  const history = { outcomes: [], routes: [] };
  if (!botLogin)
    return {
      outcome: null,
      history,
      error: 'PIPELINE_BOT_LOGIN is not set, so no note can be trusted',
    };
  let latest = null;
  let latestIndex = -1;
  let lastRouteIndex = -1;
  comments.forEach((c, i) => {
    if (c.user?.login !== botLogin) return;
    const body = c.body ?? '';
    if (body.startsWith(MARKERS.outcome)) {
      const parsed = parseOutcome(body);
      if (parsed.ok) history.outcomes.push(parsed.outcome);
      latest = parsed;
      latestIndex = i;
    } else if (body.startsWith(MARKERS.route)) {
      // A restart note only moves the budget window; it is not a route, so
      // it does not make an older outcome look already routed.
      const restart = parseRestartNote(body);
      if (restart.ok) {
        history.routes.push(restart.route);
        return;
      }
      const parsed = parseRoute(body);
      if (parsed.ok) {
        history.routes.push(parsed.route);
        lastRouteIndex = i;
      }
    }
  });
  const fail = (error) => ({ outcome: null, history, error });
  if (!latest) return fail('no outcome note from the pipeline bot');
  if (!latest.ok)
    return fail(`the latest outcome note is unparseable (${latest.error})`);
  if (lastRouteIndex > latestIndex)
    return fail('no new outcome note since the last route note');
  if (latest.outcome.result !== 'problem')
    return fail('the latest outcome is a success; there is nothing to route');
  return { outcome: latest.outcome, history, error: null };
}

const TARGET_TEXT = {
  replan: 're-plan',
  redevelop: 're-develop',
  human: 'a human',
};

/** Renders the route note, with a full hand-off summary for a human. */
export function renderRoute({ final, outcome, history = {}, mode, external }) {
  const json = {
    v: OUTCOME_VERSION,
    from_stage: outcome?.stage ?? null,
    problem: outcome?.problem ?? null,
    target: final.target,
    reason: clean(final.reason),
    round: final.round,
    cap: final.cap,
    mode,
    external: external ?? null,
    questions: cleanList(final.questions),
  };
  const stage = targetStage(final.target);
  const lines = [
    `${MARKERS.route} target=${final.target} round=${final.round} -->`,
  ];
  if (final.target === 'human') {
    lines.push(
      `**Routed to a human (\`${stage}\`), because:** ${clean(final.reason)}`,
    );
    const window = routeWindow(history.routes);
    const tried = [
      ...window.map(
        (r, i) =>
          `- Round ${i + 1}: ${r.from_stage ?? '?'} reported \`${r.problem ?? '?'}\`; routed to ${TARGET_TEXT[r.target]}.`,
      ),
    ];
    if (outcome)
      tried.push(
        `- Now: ${outcome.stage} reported \`${outcome.problem}\`: ${outcome.summary}${outcome.run_url ? ` (${outcome.run_url})` : ''}`,
      );
    if (tried.length) lines.push('', '#### What was tried', ...tried);
    const open = [
      ...new Set([
        ...window.flatMap((r) => r.questions),
        ...cleanList(final.questions),
      ]),
    ];
    if (open.length)
      lines.push('', '#### Open questions', ...open.map((q) => `- ${q}`));
    lines.push(
      '',
      `Answer or fix the cause, then the repo owner restarts it with \`/restart <qualified|planned> <reason>\` on the issue (docs/pipeline.md, "When it stops at stage:needs-attention"). Only /restart opens a fresh loop budget, and an issue gets ${MAX_LIFETIME_RESETS} restarts in its lifetime.`,
    );
  } else {
    lines.push(
      `**Routed to ${TARGET_TEXT[final.target]} (\`${stage}\`), round ${final.round}/${final.cap}, because:** ${clean(final.reason)}`,
    );
    const qs = cleanList(final.questions);
    if (qs.length)
      lines.push('', 'Questions to answer:', ...qs.map((q) => `- ${q}`));
  }
  lines.push('', '```json', JSON.stringify(json), '```');
  return lines.join('\n').slice(0, 60_000);
}

/**
 * The whole routing decision, pure: input -> rules (+ external) -> clamp ->
 * note. `external` is the (untrusted) pick from the external brain job.
 */
export function planRoute({
  comments,
  botLogin,
  mode = 'rules',
  shadow = false,
  external = null,
  facts = {},
  caps = ROUTER_CAPS,
}) {
  const { outcome, history, error } = collectRouterInput({
    comments,
    botLogin,
  });
  const allowed = outcome
    ? allowedTargets(outcome.stage, outcome.problem)
    : ['human'];
  const rules = error
    ? { target: 'human', reason: error, questions: [] }
    : decideByRules({ outcome, history });
  const chosen = chooseDecision({
    mode,
    shadow,
    rules,
    external,
    allowed,
  });
  const final = clampDecision({
    decision: chosen.decision,
    outcome,
    history,
    caps,
    facts,
  });
  return {
    final,
    stage: targetStage(final.target),
    outcome,
    allowed,
    body: renderRoute({
      final,
      outcome,
      history,
      mode: chosen.mode,
      external: chosen.external,
    }),
  };
}

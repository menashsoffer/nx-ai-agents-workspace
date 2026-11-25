// Part of the pipeline-lib tests (split from one file). Run with: pnpm test:pipeline
import {
  TARGET_STAGE,
  RESTART_STAGES,
  COMMAND_EFFECTS,
  MARKERS,
} from './pipeline-lib.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

// ---------------------------------------------------------------- effects

/**
 * Derives each command's effects from the source of the commands in
 * pipeline/commands-*.mjs (and the render/build helpers they call in
 * pipeline-lib/), so COMMAND_EFFECTS
 * (read by tools/pipeline-map) cannot drift from the code.
 */
function scanCommandEffects(helperSrc, commandSources, libSrc) {
  const fnBodies = (text) =>
    Object.fromEntries(
      [
        ...text.matchAll(
          /^(?:export )?function (\w+)\([\s\S]*?\) \{\n([\s\S]*?)^\}/gm,
        ),
      ].map((m) => [m[1], m[2]]),
    );
  const lib = fnBodies(libSrc);
  const calls = (text, names) =>
    names.filter((n) => new RegExp(`\\b${n}\\(`).test(text));

  // Markers a lib call ends up writing: MARKERS.x inside render*/build*
  // functions reachable from it (parse*/collect* only read them).
  const libMarkers = (name, seen = new Set()) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const body = lib[name];
    const own = /^(render|build)/.test(name)
      ? [...body.matchAll(/MARKERS\.(\w+)/g)].map((m) => m[1])
      : [];
    return [
      ...own,
      ...calls(body, Object.keys(lib)).flatMap((n) => libMarkers(n, seen)),
    ];
  };

  // Stages, upserts and appends of one body; `problem` marks stage writes
  // that happen only when the outcome is a problem.
  const effectsOf = (text) => {
    const fx = { stages: [], problems: [], markers: [], appends: [] };
    for (const w of text.matchAll(
      /(if \([^)]*'problem'\)\s*)?(?:setStage|stageTransition)\(\s*[^,]+,\s*'(stage:[^']+)'\)/g,
    )) {
      fx.stages.push(w[2]);
      if (w[1]) fx.problems.push(w[2]);
    }
    const rest = text.replace(
      /(upsert|find)(?:Bot)?Comment\(\s*\w+,\s*MARKERS\.(\w+)/g,
      (_, fn, key) => {
        if (fn === 'upsert') fx.markers.push(key);
        return '';
      },
    );
    for (const m of rest.matchAll(/MARKERS\.(\w+)/g)) fx.appends.push(m[1]);
    for (const n of calls(text, Object.keys(lib)))
      fx.appends.push(...libMarkers(n));
    return fx;
  };

  const helpers = fnBodies(helperSrc);
  const helperFx = Object.fromEntries(
    Object.entries(helpers).map(([n, body]) => [n, effectsOf(body)]),
  );

  const block = commandSources
    .map((src) => {
      const start = src.indexOf('Commands = {');
      return src.slice(start, src.indexOf('\n};\n', start));
    })
    .join('\n');
  const heads = [
    ...block.matchAll(
      /^ {2}(?:async )?(?:'([a-z-]+)'|([a-z][a-zA-Z]*))\(([^)]*)\) \{$/gm,
    ),
  ];
  const out = {};
  heads.forEach((h, i) => {
    const name = h[1] ?? h[2];
    const body = block.slice(h.index, heads[i + 1]?.index ?? block.length);
    const params = /^\[(.*)\]$/.exec(h[3].trim())?.[1].split(/\s*,\s*/) ?? [];
    const fx = { ...effectsOf(body), emits: [] };
    for (const [helper, hfx] of Object.entries(helperFx)) {
      for (const call of body.matchAll(new RegExp(`\\b${helper}\\(`, 'g'))) {
        // writeOutcome(n, { result: 'success', ... }) sets no stage, and
        // neither does one made with { route: false }.
        const args = body.slice(call.index, body.indexOf(');', call.index));
        const success =
          /result:\s*'success'/.test(args) || /route:\s*false/.test(args);
        if (!success) {
          fx.stages.push(...hfx.stages);
          fx.problems.push(...hfx.problems);
        }
        fx.markers.push(...hfx.markers);
        fx.appends.push(...hfx.appends);
      }
    }
    for (const w of body.matchAll(/setStage\(\s*[^,]+,\s*([\w.]+)\)/g)) {
      const expr = w[1];
      if (params.includes(expr))
        fx.args = { ...fx.args, stage: params.indexOf(expr) };
      else if (/\bplanRoute\(/.test(body)) {
        // The router sets whatever stage its target maps to.
        fx.stages.push(...Object.values(TARGET_STAGE));
        fx.problems.push(TARGET_STAGE.human);
      } else assert.fail(`${name}: cannot resolve setStage(${expr})`);
    }
    // The restart command sets whatever stage its /restart argument maps to.
    if (/\bdecideRestart\(/.test(body))
      fx.stages.push(...Object.values(RESTART_STAGES));
    const flagAdd = /editLabels\([^{]*\{\s*add:\s*many\(f\.(\w+)\)/.exec(body);
    if (flagAdd) fx.args = { ...fx.args, stage: `--${flagAdd[1]}` };
    const dyn = /MARKERS\[(\w+)\]/.exec(body);
    if (dyn) fx.args = { ...fx.args, marker: params.indexOf(dyn[1]) };
    if (
      /requested_reviewers/.test(body) ||
      /api\(\s*`pulls\/\$\{\w+\}\/reviews`,\s*\{\s*method:\s*'POST'/.test(body)
    )
      fx.emits.push('pull_request_review');
    if (
      /\brender(?:Disposition|ProtectedApproved)Note\(|\breviewOutcome\(/.test(
        body,
      )
    )
      fx.emits.push('issue_comment');
    // Opening a PR through the API (an approved branch).
    if (/api\(\s*'pulls',\s*\{\s*method:\s*'POST'/.test(body))
      fx.emits.push('pull_request');
    out[name] = normaliseEffects(fx);
  });
  return out;
}

function normaliseEffects(fx) {
  const uniq = (a = []) => [...new Set(a)].sort();
  const markers = uniq(fx.markers);
  const n = {
    stages: uniq(fx.stages),
    problems: uniq(fx.problems),
    markers,
    // A rendered comment that is upserted is not an append.
    appends: uniq(fx.appends).filter((k) => !markers.includes(k)),
    emits: uniq(fx.emits),
  };
  if (fx.args) n.args = fx.args;
  return n;
}

test('COMMAND_EFFECTS matches what each pipeline.mjs command does', () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const scanned = scanCommandEffects(
    read('./pipeline/helpers.mjs'),
    readdirSync(new URL('./pipeline/', import.meta.url))
      .filter((f) => /^commands-.*\.mjs$/.test(f))
      .map((f) => read(`./pipeline/${f}`)),
    readdirSync(new URL('./pipeline-lib/', import.meta.url))
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => read(`./pipeline-lib/${f}`))
      .join('\n') + read('./review-lib.mjs'),
  );
  assert.ok(Object.keys(scanned).length >= 15, 'scanner found the commands');
  const hasEffect = (fx) =>
    fx.stages.length ||
    fx.markers.length ||
    fx.appends.length ||
    fx.emits.length ||
    fx.args;
  const expected = Object.fromEntries(
    Object.entries(scanned).filter(([, fx]) => hasEffect(fx)),
  );
  const table = Object.fromEntries(
    Object.entries(COMMAND_EFFECTS).map(([k, v]) => [k, normaliseEffects(v)]),
  );
  assert.deepEqual(table, expected);
  for (const fx of Object.values(COMMAND_EFFECTS)) {
    for (const key of [...fx.markers, ...fx.appends])
      assert.ok(MARKERS[key], `marker ${key}`);
    for (const p of fx.problems ?? []) assert.ok(fx.stages.includes(p));
  }
});

// Turns parsed workflows + pipeline-lib exports into a graph and findings.
// Pure and deterministic: every list is sorted, nothing depends on time.
import { COMMAND_EVENTS, DEFAULT_TYPES, EXPECTED_UNGATED } from './config.mjs';
import { triggerText } from './workflows.mjs';

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (xs) => [...new Set(xs)].sort(byStr);
const slug = (s) => s.replace(/\.ya?ml$/, '').replace(/[^a-zA-Z0-9]+/g, '_');

export const stageId = (s) => `s_${slug(s)}`;
export const workflowId = (f) => `w_${slug(f)}`;
export const loopId = (l) => `l_${slug(l)}`;

/** `lib` needs STAGES, MARKERS and COMMAND_EFFECTS; FIX_LOOP_* are optional. */
export function buildModel({
  workflows,
  lib,
  expectedUngated = EXPECTED_UNGATED,
}) {
  const stages = lib.STAGES;
  const markers = lib.MARKERS;
  const effects = lib.COMMAND_EFFECTS ?? {};
  const loopLabels = Object.entries(lib)
    .filter(([k]) => k.startsWith('FIX_LOOP_'))
    .map(([, v]) => v);

  const wfs = [...workflows]
    .sort((a, b) => byStr(a.file, b.file))
    .map((wf) => resolveWorkflow(wf, effects, markers));
  const edges = [];
  const nodes = new Map();
  const addNode = (id, text, cls, shape) => {
    if (!nodes.has(id)) nodes.set(id, { id, text, cls, shape });
  };
  const edge = (from, to, kind, label = '') =>
    edges.push({ from, to, kind, label });

  // -------------------------------------------------- labels and stages
  const setStages = sorted(wfs.flatMap((w) => w.writes.map((x) => x.stage)));
  const gatedStages = sorted(wfs.flatMap((w) => w.gates.labels));
  const problemStages = sorted(
    wfs.flatMap((w) => w.writes.filter((x) => x.problem).map((x) => x.stage)),
  );
  const labelNode = (label) => {
    const id = stages.includes(label) ? stageId(label) : `lb_${slug(label)}`;
    addNode(id, label, 'stage', 'round');
    return id;
  };

  for (const w of wfs) {
    const wid = workflowId(w.file);
    for (const label of w.gates.labels) edge(labelNode(label), wid, 'gate');
    for (const prefix of w.gates.prefixes) {
      const except = w.gates.excluded.filter((l) => l.startsWith(prefix));
      const text = `any ${prefix}* label${except.length ? ` except ${except.join(', ')}` : ''}`;
      const id = `g_${slug(w.file)}_${slug(prefix)}`;
      addNode(id, text, 'gate', 'flag');
      edge(id, wid, 'gate');
    }
    const writes = new Map();
    for (const x of w.writes)
      writes.set(x.stage, (writes.get(x.stage) ?? true) && x.problem);
    for (const [stage, problem] of writes)
      edge(wid, labelNode(stage), problem ? 'problem' : 'write');
  }

  // -------------------------------------------------- workflow -> workflow
  for (const a of wfs) {
    for (const b of wfs) {
      if (a === b) continue;
      const labels = [];
      for (const e of a.emits)
        if (b.triggers.some((t) => triggerMatches(t, e))) labels.push(e.label);
      for (const d of a.dispatches)
        if (
          d === b.file &&
          b.triggers.some((t) => t.event === 'workflow_dispatch')
        )
          labels.push('dispatch');
      if (
        b.triggers.some(
          (t) => t.event === 'workflow_run' && t.workflows?.includes(a.name),
        )
      )
        labels.push(
          b.gates.runConclusions.length
            ? `on ${b.gates.runConclusions.join('/')}`
            : 'workflow_run',
        );
      if (labels.length)
        edge(
          workflowId(a.file),
          workflowId(b.file),
          'event',
          sorted(labels).join(' / '),
        );
    }
  }

  // -------------------------------------------------- fix loop
  for (const w of wfs) {
    const loops = w.loops.filter((l) => loopLabels.includes(l));
    loops.forEach((l, i) => {
      addNode(loopId(l), l, 'loop', 'hex');
      edge(
        i ? loopId(loops[i - 1]) : workflowId(w.file),
        loopId(l),
        'loop',
        `round ${i + 1}`,
      );
    });
    if (loops.length)
      for (const stage of w.loopProblems)
        edge(loopId(loops.at(-1)), labelNode(stage), 'problem', 'budget spent');
  }

  // -------------------------------------------------- humans
  const entryStages = gatedStages.filter(
    (s) => stages.includes(s) && !setStages.includes(s),
  );
  const triageNext = [];
  for (const s of setStages) {
    const next =
      expectedUngated[s]?.kind === 'triage' && expectedUngated[s].next;
    if (!next || !stages.includes(next)) continue;
    edge(stageId(s), labelNode(next), 'human', 'human triage');
    triageNext.push(next);
  }
  for (const s of entryStages.filter((s) => !triageNext.includes(s))) {
    addNode('h_entry', '👤 Human adds the label', 'human', 'stadium');
    edge('h_entry', stageId(s), 'human');
  }
  for (const s of setStages) {
    const cfg = expectedUngated[s];
    if (cfg?.kind !== 'human') continue;
    const id = `h_${slug(s)}`;
    addNode(id, `👤 ${cfg.human ?? 'Human'}`, 'human', 'stadium');
    edge(stageId(s), id, 'human');
  }

  // Workflows on the map; the ones nothing triggers start from outside.
  const onMap = new Set(edges.flatMap((e) => [e.from, e.to]));
  for (const w of wfs) {
    const wid = workflowId(w.file);
    if (!onMap.has(wid)) continue;
    addNode(wid, w.file, 'workflow', 'rect');
    if (!edges.some((e) => e.to === wid)) {
      const id = `h_src_${slug(w.file)}`;
      addNode(
        id,
        `👤 ${w.triggers.map(triggerText).join(', ')}`,
        'human',
        'stadium',
      );
      edge(id, wid, 'human');
    }
  }
  for (const s of entryStages) nodes.get(stageId(s)).cls = 'human';
  for (const s of problemStages) nodes.get(stageId(s)).cls = 'problem';

  return {
    workflows: wfs,
    nodes: [...nodes.values()].sort((a, b) => byStr(a.id, b.id)),
    edges: sortEdges(dedupeEdges(edges)),
    markerWriters: markerWriters(wfs, markers),
    findings: findings({
      wfs,
      stages,
      markers,
      setStages,
      gatedStages,
      entryStages,
      expectedUngated,
    }),
    expectedUngated,
  };
}

// ------------------------------------------------------------ resolving

/** Applies COMMAND_EFFECTS to a workflow's pipeline.mjs calls. */
export function resolveWorkflow(wf, effects, markers) {
  const writes = [];
  const markerWrites = [];
  const emits = wf.events.filter((e) => e.event !== 'workflow_dispatch');
  const dispatches = wf.events
    .filter((e) => e.event === 'workflow_dispatch')
    .map((e) => e.workflow);
  const loops = [];
  const loopProblems = [];
  const argAt = (call, at) =>
    typeof at === 'number'
      ? [call.args[at]]
      : call.args.filter((_, i) => i > 0 && call.args[i - 1] === at);
  const literal = (v) => typeof v === 'string' && v && !/[$`]/.test(v);

  wf.calls.forEach((call) => {
    const fx = effects[call.command];
    if (!fx) return;
    for (const stage of fx.stages)
      writes.push({
        stage,
        command: call.command,
        problem: (fx.problems ?? []).includes(stage),
      });
    if (fx.args?.stage !== undefined)
      for (const stage of argAt(call, fx.args.stage).filter(literal))
        writes.push({
          stage,
          command: call.command,
          problem: false,
        });
    const write = (key, append) =>
      markerWrites.push({ key, command: call.command, append });
    for (const key of fx.markers) write(key, false);
    for (const key of fx.appends ?? []) write(key, true);
    if (fx.args?.marker !== undefined)
      for (const key of argAt(call, fx.args.marker).filter(literal))
        if (markers[key]) write(key, false);
    for (const event of fx.emits)
      emits.push({
        event,
        ...(COMMAND_EVENTS[event] ?? { action: null, label: event }),
      });
    for (const l of fx.loops ?? []) loops.push(l);
    if (fx.loops) loopProblems.push(...(fx.problems ?? []));
  });

  return {
    ...wf,
    id: workflowId(wf.file),
    writes,
    markerWrites,
    emits,
    dispatches,
    loops: [...new Set(loops)],
    loopProblems: sorted(loopProblems),
  };
}

export function triggerMatches(trigger, emitted) {
  if (trigger.event !== emitted.event) return false;
  if (!emitted.action) return true;
  const types = trigger.types ?? DEFAULT_TYPES[trigger.event];
  return !types || types.includes(emitted.action);
}

function dedupeEdges(edges) {
  const out = new Map();
  for (const e of edges) {
    const key = `${e.from}>${e.to}>${e.kind}`;
    const seen = out.get(key);
    if (!seen) out.set(key, { ...e });
    else if (e.label && !seen.label.split(' / ').includes(e.label))
      seen.label = sorted([
        ...seen.label.split(' / ').filter(Boolean),
        e.label,
      ]).join(' / ');
  }
  return [...out.values()];
}

const EDGE_ORDER = ['human', 'gate', 'write', 'event', 'loop', 'problem'];
function sortEdges(edges) {
  return edges.sort(
    (a, b) =>
      EDGE_ORDER.indexOf(a.kind) - EDGE_ORDER.indexOf(b.kind) ||
      byStr(a.from, b.from) ||
      byStr(a.to, b.to),
  );
}

function markerWriters(wfs, markers) {
  return Object.keys(markers)
    .sort(byStr)
    .map((key) => {
      const by = (append) => {
        const writers = new Map();
        for (const w of wfs)
          for (const m of w.markerWrites)
            if (m.key === key && m.append === append)
              writers.set(
                w.file,
                sorted([...(writers.get(w.file) ?? []), m.command]),
              );
        return [...writers].sort(([a], [b]) => byStr(a, b));
      };
      return {
        key,
        marker: markers[key],
        upserts: by(false),
        appends: by(true),
      };
    });
}

// ------------------------------------------------------------ findings

function findings({
  wfs,
  stages,
  markers,
  setStages,
  gatedStages,
  entryStages,
  expectedUngated,
}) {
  const out = [];
  const code = (s) => `\`${s}\``;
  const files = (list) => list.map(code).join(', ');

  // Append-only notes are shared by design; a comment several workflows
  // upsert is one comment they keep overwriting.
  for (const { marker, upserts } of markerWriters(wfs, markers))
    if (upserts.length > 1)
      out.push({
        kind: 'shared-marker',
        text: `${code(marker)} is upserted by ${upserts.length} workflows: ${files(upserts.map(([f]) => f))}.`,
      });

  const unwritten = Object.keys(markers)
    .sort(byStr)
    .filter((k) => !wfs.some((w) => w.markerWrites.some((m) => m.key === k)));
  if (unwritten.length)
    out.push({
      kind: 'unwritten-marker',
      text: `Markers no workflow writes: ${files(unwritten)}.`,
    });

  for (const s of stages.filter((s) => !setStages.includes(s)))
    out.push({
      kind: 'never-set',
      text: `${code(s)} is never set by a workflow${entryStages.includes(s) ? ' (a human adds it; it starts the pipeline)' : ''}.`,
    });

  const unknown = sorted(
    [...setStages, ...gatedStages].filter(
      (l) => l.startsWith('stage:') && !stages.includes(l),
    ),
  );
  if (unknown.length)
    out.push({
      kind: 'unknown-stage',
      text: `Stage labels used by workflows but missing from \`STAGES\`: ${files(unknown)}.`,
    });

  const ungated = setStages.filter(
    (s) => !gatedStages.includes(s) && !expectedUngated[s],
  );
  out.push({
    kind: 'ungated',
    text: ungated.length
      ? `Set but never gated, and not in \`EXPECTED_UNGATED\`: ${files(ungated)}. Nothing reacts to these labels.`
      : 'Every stage that is set is either gated or listed in `EXPECTED_UNGATED`.',
  });
  const stale = Object.keys(expectedUngated)
    .sort(byStr)
    .filter((s) => gatedStages.includes(s) || !setStages.includes(s));
  if (stale.length)
    out.push({
      kind: 'stale-expected',
      text: `\`EXPECTED_UNGATED\` lists ${files(stale)}, which ${stale.length > 1 ? 'are' : 'is'} now gated or never set: update tools/pipeline-map/src/config.mjs.`,
    });

  const humanStages = Object.keys(expectedUngated).filter(
    (s) => expectedUngated[s].kind === 'human',
  );
  for (const s of humanStages.sort(byStr)) {
    const direct = wfs
      .filter((w) => w.writes.some((x) => x.problem && x.stage === s))
      .map((w) => w.file);
    if (direct.length)
      out.push({
        kind: 'direct-escalation',
        text: `${direct.length} workflow${direct.length > 1 ? 's escalate' : ' escalates'} straight to ${code(s)}: ${files(direct)}.`,
      });
  }
  return out;
}

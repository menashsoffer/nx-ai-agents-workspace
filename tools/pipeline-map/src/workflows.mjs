// Reads .github/workflows/*.yml with a real YAML parser and extracts what the
// pipeline map needs: triggers, label gates and pipeline.mjs calls. Only
// expression strings (`if:`) and shell scripts (`run:`) are matched with
// regexes; the YAML structure never is.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** Parses every workflow file in `dir`, sorted by file name. */
export function readWorkflows(dir) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => parseWorkflow(file, readFileSync(join(dir, file), 'utf8')));
}

export function parseWorkflow(file, text) {
  const doc = parse(text) ?? {};
  // YAML 1.1 parsers read a bare `on` key as `true`; accept both.
  const on = doc.on ?? doc['true'];
  const jobs = Object.values(doc.jobs ?? {});
  const gates = emptyGates();
  const calls = [];
  const events = [];
  let step = 0;
  for (const job of jobs) {
    if (typeof job?.if === 'string') addGates(gates, job.if);
    for (const s of job?.steps ?? []) {
      step++;
      if (typeof s?.run !== 'string') continue;
      calls.push(...pipelineCalls(s.run).map((c) => ({ ...c, step })));
      events.push(...shellEvents(s.run));
    }
  }
  return {
    file,
    name: typeof doc.name === 'string' ? doc.name : file,
    triggers: parseTriggers(on),
    gates: sortGates(gates),
    calls,
    events: uniqueBy(events, (e) => `${e.event}:${e.action}:${e.workflow}`),
  };
}

// ------------------------------------------------------------ triggers

const list = (v) =>
  v === undefined || v === null ? undefined : [].concat(v).map(String);

/** `on:` as a string, a list or a map -> [{ event, types?, workflows?, branches? }]. */
export function parseTriggers(on) {
  if (!on) return [];
  if (typeof on === 'string') return [{ event: on }];
  if (Array.isArray(on)) return on.map((event) => ({ event: String(event) }));
  return Object.entries(on)
    .map(([event, cfg]) => {
      const t = { event };
      for (const key of ['types', 'workflows', 'branches']) {
        const v = list(cfg?.[key]);
        if (v) t[key] = v;
      }
      return t;
    })
    .sort((a, b) => a.event.localeCompare(b.event));
}

export function triggerText(t) {
  const detail = [
    t.workflows ? t.workflows.join(', ') : '',
    t.types ? t.types.join('/') : '',
    t.branches ? `branches ${t.branches.join(', ')}` : '',
  ].filter(Boolean);
  return detail.length ? `${t.event}: ${detail.join(' ')}` : t.event;
}

// ------------------------------------------------------------ gates

function emptyGates() {
  return {
    labels: [],
    prefixes: [],
    excluded: [],
    statusContexts: [],
    runConclusions: [],
  };
}

const LABEL = String.raw`github\.event\.label\.name`;
const STR = String.raw`'([^']*)'`;
/** @type {[string, RegExp][]} */
const GATE_PATTERNS = [
  ['labels', new RegExp(`${LABEL}\\s*==\\s*${STR}`, 'g')],
  ['labels', new RegExp(`${STR}\\s*==\\s*${LABEL}`, 'g')],
  ['excluded', new RegExp(`${LABEL}\\s*!=\\s*${STR}`, 'g')],
  [
    'prefixes',
    new RegExp(`startsWith\\(\\s*${LABEL}\\s*,\\s*${STR}\\s*\\)`, 'g'),
  ],
  [
    'statusContexts',
    new RegExp(`github\\.event\\.context\\s*==\\s*${STR}`, 'g'),
  ],
  [
    'runConclusions',
    new RegExp(
      `github\\.event\\.workflow_run\\.conclusion\\s*==\\s*${STR}`,
      'g',
    ),
  ],
];

/** Label and event gates found in one `if:` expression. */
export function addGates(gates, expr) {
  for (const [key, re] of GATE_PATTERNS)
    for (const m of expr.matchAll(re)) gates[key].push(m[1]);
  return gates;
}

function sortGates(g) {
  return Object.fromEntries(
    Object.entries(g).map(([k, v]) => [k, [...new Set(v)].sort()]),
  );
}

// ------------------------------------------------------------ run scripts

/** Splits a shell word list, honouring quotes. Stops at ; | & > and #. */
export function shellWords(text) {
  const words = [];
  let cur = null;
  let quote = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur ??= '';
    } else if (/\s/.test(ch)) {
      if (cur !== null) words.push(cur);
      cur = null;
    } else if (';|&>#'.includes(ch) && cur === null) break;
    else cur = (cur ?? '') + ch;
  }
  if (cur !== null) words.push(cur);
  return words;
}

/** Every `pipeline.mjs <command> <args...>` in a run script, in order. */
export function pipelineCalls(run) {
  const joined = run.replace(/\\\r?\n/g, ' ');
  const calls = [];
  for (const m of joined.matchAll(/pipeline\.mjs["']?[ \t]+([^\n]*)/g)) {
    const [command, ...args] = shellWords(m[1]);
    if (command) calls.push({ command, args });
  }
  return calls;
}

/** Events caused by plain shell commands (not pipeline.mjs). */
export function shellEvents(run) {
  const opensPr = /\bgh\s+pr\s+create\b/.test(run);
  const events = [];
  if (opensPr)
    events.push({ event: 'pull_request', action: 'opened', label: 'opens PR' });
  // A push that is part of opening the PR triggers nothing by itself.
  else if (/\bgit\s+push\b/.test(run))
    events.push({
      event: 'pull_request',
      action: 'synchronize',
      label: 'push',
    });
  for (const m of run.matchAll(
    /\bgh\s+workflow\s+run\s+["']?([\w.-]+\.ya?ml)/g,
  ))
    events.push({
      event: 'workflow_dispatch',
      workflow: m[1],
      label: 'dispatch',
    });
  return events;
}

function uniqueBy(items, key) {
  const seen = new Map();
  for (const it of items) if (!seen.has(key(it))) seen.set(key(it), it);
  return [...seen.values()];
}

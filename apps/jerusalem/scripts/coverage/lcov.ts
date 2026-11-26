// Parses LCOV reports and merges the Node (node --test) and Vitest reports into one result.
// Vitest lists every file in scope, so its line and function sets are the reference. A line or
// function counts as covered when either runner executed it. Branch ids differ between the two
// runners, so a file's branch share is the better of the two, applied to Vitest's branch count.

export interface FileCoverage {
  lines: Map<number, number>;
  functions: Map<number, number>;
  branchesFound: number;
  branchesHit: number;
}

export type Report = Map<string, FileCoverage>;

export interface Totals {
  found: number;
  hit: number;
}

export interface Summary {
  lines: Totals;
  functions: Totals;
  branches: Totals;
}

function emptyFile(): FileCoverage {
  return { lines: new Map(), functions: new Map(), branchesFound: 0, branchesHit: 0 };
}

function addHits(map: Map<number, number>, key: number, hits: number): void {
  map.set(key, (map.get(key) ?? 0) + hits);
}

function applyRecord(file: FileCoverage, tag: string, value: string): void {
  const parts = value.split(',');
  if (tag === 'DA') addHits(file.lines, Number(parts[0]), Number(parts[1]));
  else if (tag === 'FN') addHits(file.functions, Number(parts[0]), 0);
  else if (tag === 'BRF') file.branchesFound += Number(value);
  else if (tag === 'BRH') file.branchesHit += Number(value);
}

// FNDA names a function, not a line, so function hits are resolved after the record ends.
function functionHits(record: string[]): Map<string, number> {
  const hits = new Map<string, number>();
  for (const row of record.filter((line) => line.startsWith('FNDA:'))) {
    const [count = '0', ...name] = row.slice('FNDA:'.length).split(',');
    hits.set(name.join(','), (hits.get(name.join(',')) ?? 0) + Number(count));
  }
  return hits;
}

function parseRecord(record: string[], root: string): [string, FileCoverage] | undefined {
  const source = record.find((line) => line.startsWith('SF:'));
  if (source === undefined) return undefined;
  const file = emptyFile();
  const hits = functionHits(record);
  for (const row of record) {
    const colon = row.indexOf(':');
    if (colon > 0) applyRecord(file, row.slice(0, colon), row.slice(colon + 1));
    if (row.startsWith('FN:')) {
      const [line = '0', ...name] = row.slice('FN:'.length).split(',');
      addHits(file.functions, Number(line), hits.get(name.join(',')) ?? 0);
    }
  }
  return [relativePath(source.slice('SF:'.length), root), file];
}

export function relativePath(path: string, root: string): string {
  const normalized = path.replaceAll('\\', '/');
  const prefix = root.replaceAll('\\', '/').replace(/\/?$/, '/');
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

export function parseLcov(text: string, root: string): Report {
  const report: Report = new Map();
  let record: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() !== 'end_of_record') {
      record.push(line.trim());
      continue;
    }
    const parsed = parseRecord(record, root);
    if (parsed) report.set(parsed[0], parsed[1]);
    record = [];
  }
  return report;
}

function orHits(reference: Map<number, number>, other: Map<number, number>): Map<number, number> {
  const merged = new Map<number, number>();
  for (const [key, hits] of reference) merged.set(key, hits + (other.get(key) ?? 0));
  return merged;
}

function share(hit: number, found: number): number {
  return found === 0 ? 1 : hit / found;
}

function mergeFile(reference: FileCoverage, other: FileCoverage | undefined): FileCoverage {
  if (other === undefined) return reference;
  const best = Math.max(
    share(reference.branchesHit, reference.branchesFound),
    share(other.branchesHit, other.branchesFound),
  );
  return {
    lines: orHits(reference.lines, other.lines),
    functions: orHits(reference.functions, other.functions),
    branchesFound: reference.branchesFound,
    branchesHit: Math.round(best * reference.branchesFound),
  };
}

// Files that only Node reports (outside Vitest's scope) are left out on purpose.
export function mergeReports(vitest: Report, node: Report): Report {
  const merged: Report = new Map();
  for (const [path, file] of vitest) merged.set(path, mergeFile(file, node.get(path)));
  return merged;
}

function count(map: Map<number, number>): Totals {
  return { found: map.size, hit: [...map.values()].filter((hits) => hits > 0).length };
}

export function summarizeFile(file: FileCoverage): Summary {
  return {
    lines: count(file.lines),
    functions: count(file.functions),
    branches: { found: file.branchesFound, hit: file.branchesHit },
  };
}

export function summarize(report: Report): Summary {
  const total: Summary = {
    lines: { found: 0, hit: 0 },
    functions: { found: 0, hit: 0 },
    branches: { found: 0, hit: 0 },
  };
  for (const file of report.values()) {
    const one = summarizeFile(file);
    for (const key of ['lines', 'functions', 'branches'] as const) {
      total[key].found += one[key].found;
      total[key].hit += one[key].hit;
    }
  }
  return total;
}

export function percent(totals: Totals): number {
  return totals.found === 0 ? 100 : (100 * totals.hit) / totals.found;
}

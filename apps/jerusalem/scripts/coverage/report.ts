// Turns merged coverage into a Markdown report and a list of failed thresholds.
import { percent, summarize, summarizeFile, type Report, type Totals } from './lcov.ts';
import { uncalled } from './sql.ts';

export interface Thresholds {
  lines: number;
  branches: number;
  functions: number;
  sqlFunctions: number;
}

export interface CoverageResult {
  text: string;
  failures: string[];
}

const METRICS = ['lines', 'branches', 'functions'] as const;
const SHOWN_FILES = 25;

function cell(totals: Totals): string {
  return `${percent(totals).toFixed(1)}% (${String(totals.hit)}/${String(totals.found)})`;
}

function weakestFiles(report: Report, thresholds: Thresholds): string[] {
  const rows = [...report]
    .map(([path, file]) => ({ path, summary: summarizeFile(file) }))
    .filter(({ summary }) => METRICS.some((key) => percent(summary[key]) < thresholds[key]))
    .sort((a, b) => percent(a.summary.lines) - percent(b.summary.lines));
  return rows
    .slice(0, SHOWN_FILES)
    .map(
      ({ path, summary }) => `| ${path} | ${METRICS.map((k) => cell(summary[k])).join(' | ')} |`,
    );
}

function sqlSection(calls: Map<string, number>): string[] {
  const missing = uncalled(calls);
  if (missing.length === 0) return [];
  return ['', 'SQL functions no test calls:', '', ...missing.map((name) => `- \`${name}\``)];
}

export function formatReport(
  report: Report,
  calls: Map<string, number>,
  thresholds: Thresholds,
): CoverageResult {
  const total = summarize(report);
  const sql: Totals = { found: calls.size, hit: calls.size - uncalled(calls).length };
  const failures = METRICS.filter((key) => percent(total[key]) < thresholds[key]).map(
    (key) => `${key}: ${percent(total[key]).toFixed(2)}% < ${String(thresholds[key])}%`,
  );
  if (percent(sql) < thresholds.sqlFunctions) {
    failures.push(
      `SQL functions: ${percent(sql).toFixed(2)}% < ${String(thresholds.sqlFunctions)}%`,
    );
  }
  const weak = weakestFiles(report, thresholds);
  const text = [
    '## Test coverage',
    '',
    '| | Lines | Branches | Functions | SQL functions |',
    '| --- | --- | --- | --- | --- |',
    `| All | ${METRICS.map((key) => cell(total[key])).join(' | ')} | ${cell(sql)} |`,
    ...(weak.length > 0
      ? ['', 'Files below the threshold:', '', '| File | Lines | Branches | Functions |']
      : []),
    ...(weak.length > 0 ? ['| --- | --- | --- | --- |', ...weak] : []),
    ...sqlSection(calls),
    '',
  ].join('\n');
  return { text, failures };
}

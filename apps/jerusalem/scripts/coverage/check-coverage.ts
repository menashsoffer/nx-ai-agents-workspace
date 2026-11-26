// Merges the coverage of all test runners and fails below the thresholds in scope.json.
// Run through `npm run coverage`, which produces the input files first.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mergeReports, parseLcov, percent, summarize } from './lcov.ts';
import { formatReport, type Thresholds } from './report.ts';
import { mergeCalls, PARTIAL_PREFIX, parseCalls } from './sql.ts';

const ROOT = process.cwd();
const COVERAGE = join(ROOT, 'coverage');

function readLcov(path: string) {
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run npm run coverage.`);
  return parseLcov(readFileSync(path, 'utf8'), ROOT);
}

function readSqlCalls() {
  const dir = join(COVERAGE, 'sql');
  if (!existsSync(dir)) throw new Error(`Missing ${dir}. Run npm run coverage.`);
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  const read = (names: string[]) =>
    names.map((name) => parseCalls(readFileSync(join(dir, name), 'utf8')));
  const partial = files.filter((name) => name.startsWith(PARTIAL_PREFIX));
  return mergeCalls(read(files.filter((name) => !partial.includes(name))), read(partial));
}

const scope = JSON.parse(readFileSync(join(ROOT, 'scripts/coverage/scope.json'), 'utf8')) as {
  thresholds: Thresholds;
};
const merged = mergeReports(
  readLcov(join(COVERAGE, 'vitest', 'lcov.info')),
  readLcov(join(COVERAGE, 'node.lcov')),
);
const result = formatReport(merged, readSqlCalls(), scope.thresholds);
console.log(result.text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.text);
if (result.failures.length > 0) {
  console.error(`Coverage is below the threshold:\n${result.failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Coverage passes (lines ${percent(summarize(merged).lines).toFixed(2)}%).`);
}

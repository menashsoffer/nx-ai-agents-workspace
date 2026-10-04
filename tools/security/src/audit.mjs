// D1 / D2 / D2-T: dependency advisories from `pnpm audit`.
import { spawnSync } from 'node:child_process';

const GATING = ['high', 'critical'];

/**
 * Parses `pnpm audit --json` output into [{ id, severity, module, paths }].
 * Throws on anything that is not a real advisory report: pnpm prints
 * `{"error":...}` (which also starts with `{`) when the registry is
 * unreachable, and an empty list from that would read as "no advisories".
 */
export function parseAudit(json) {
  const report = JSON.parse(json);
  if (report.error) {
    throw new Error(
      `pnpm audit failed: ${report.error.message ?? JSON.stringify(report.error)}`,
    );
  }
  if (!report.advisories || typeof report.advisories !== 'object') {
    throw new Error(
      'pnpm audit output has no "advisories" object (did the format change?); not treating it as clean.',
    );
  }
  const advisories = Object.values(report.advisories).map((a) => ({
    id: a.github_advisory_id ?? String(a.id),
    severity: a.severity,
    module: a.module_name,
    title: a.title,
    paths: (a.findings ?? []).flatMap((f) => f.paths ?? []),
  }));
  // The summary must agree with the list: counts but no advisories means the
  // advisory format changed under us.
  const counts = report.metadata?.vulnerabilities ?? {};
  const counted = GATING.reduce((sum, level) => sum + (counts[level] ?? 0), 0);
  const listed = advisories.filter((a) => GATING.includes(a.severity)).length;
  if (counted > 0 && listed === 0) {
    throw new Error(
      `pnpm audit counts ${counted} high/critical vulnerabilities but lists none; not treating it as clean.`,
    );
  }
  return advisories;
}

export function gatingAdvisories(advisories, excepted = new Set()) {
  return advisories.filter(
    (a) => GATING.includes(a.severity) && !excepted.has(a.id),
  );
}

export function runAudit(cwd, { prod }) {
  const args = ['audit', '--json', ...(prod ? ['--prod'] : [])];
  // pnpm audit exits non-zero when it finds anything; the JSON is what matters.
  const result = spawnSync('pnpm', args, { cwd, encoding: 'utf8' });
  if (!result.stdout?.trim().startsWith('{')) {
    throw new Error(
      `pnpm ${args.join(' ')} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return parseAudit(result.stdout);
}

export const describe = (a) =>
  `${a.id} ${a.severity} ${a.module}: ${a.title} (${a.paths[0] ?? '?'})`;

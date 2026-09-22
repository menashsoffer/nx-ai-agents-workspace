// D1 / D2 / D2-T: dependency advisories from `pnpm audit`.
import { spawnSync } from 'node:child_process';

const GATING = ['high', 'critical'];

/** Parses `pnpm audit --json` output into [{ id, severity, module, paths }]. */
export function parseAudit(json) {
  const report = JSON.parse(json);
  return Object.values(report.advisories ?? {}).map((a) => ({
    id: a.github_advisory_id ?? String(a.id),
    severity: a.severity,
    module: a.module_name,
    title: a.title,
    paths: (a.findings ?? []).flatMap((f) => f.paths ?? []),
  }));
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

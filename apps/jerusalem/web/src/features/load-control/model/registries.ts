import type { LoadControl } from '../api/control.ts';

type Registry = LoadControl['registries'][number];
const normal = (text: string) => text.normalize('NFKC').toLocaleLowerCase('he').trim();

/** Registries whose name holds the query, most rows still in review first. */
export function listRegistries(registries: Registry[], query: string): Registry[] {
  const wanted = normal(query);
  return registries
    .filter((r) => normal(r.name).includes(wanted))
    .sort((a, b) => b.needs_review - a.needs_review || a.name.localeCompare(b.name, 'he'));
}

/** All candidates waiting, with one line on where they came from. */
export function candidateTotal(candidates: LoadControl['candidates']): number {
  return Object.values(candidates).reduce((sum, n) => sum + n, 0);
}

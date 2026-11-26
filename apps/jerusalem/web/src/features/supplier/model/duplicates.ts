import type { WriteContext } from '../../../data/write-context.ts';

export interface Candidate {
  id: string;
  name: string;
  identifierMatch: boolean;
  /** The pools the supplier is listed in, so the user can tell similar names apart. */
  registries: string[];
}

function registriesOf(context: WriteContext): Map<string, string[]> {
  const { catalog } = context;
  const names = new Map(catalog.registries.map((r) => [r.id, r.name]));
  const versions = new Map(catalog.versions.map((v) => [v.id, names.get(v.registry_id) ?? '']));
  const result = new Map<string, string[]>();
  for (const m of catalog.memberships) {
    const name = versions.get(m.registry_version_id);
    if (!name) continue;
    const list = result.get(m.supplier_id) ?? [];
    if (!list.includes(name)) list.push(name);
    result.set(m.supplier_id, list);
  }
  return result;
}
function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('he')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function closeName(left: string, right: string): boolean {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))))
    return true;
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 5) return false;
  return editDistance(a, b) <= 2;
}

function editDistance(a: string, b: string): number {
  let prior = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        (next[j - 1] ?? 0) + 1,
        (prior[j] ?? 0) + 1,
        (prior[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prior = next;
  }
  return prior[b.length] ?? Infinity;
}
export function duplicates(context: WriteContext, name: string, identifier: string): Candidate[] {
  const exactIds = new Set(
    context.identifiers
      .filter((row) => identifier && row.value === identifier)
      .map((row) => row.supplier_id),
  );
  const names = new Map<string, string[]>();
  for (const row of context.catalog.names) {
    const values = names.get(row.supplier_id) ?? [];
    values.push(row.name);
    names.set(row.supplier_id, values);
  }
  const pools = registriesOf(context);
  return context.catalog.suppliers
    .filter((row) => row.status === 'active')
    .flatMap((row) => {
      const idMatch = exactIds.has(row.id);
      const nameMatch = [row.display_name, ...(names.get(row.id) ?? [])].some((value) =>
        closeName(value, name),
      );
      return idMatch || nameMatch
        ? [
            {
              id: row.id,
              name: row.display_name,
              identifierMatch: idMatch,
              registries: pools.get(row.id) ?? [],
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        Number(b.identifierMatch) - Number(a.identifierMatch) || a.name.localeCompare(b.name, 'he'),
    );
}

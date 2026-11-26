// Merges the per-database function call counts that supabase/tests/pglite.ts writes when
// SQL_COVERAGE_DIR is set. A function is covered when any test database called it. Only the
// functions of fully migrated databases count: a database stopped at an older migration still
// has functions that a later migration drops, and those must not be listed as untested.

export interface FunctionCalls {
  name: string;
  calls: number;
}

export function parseCalls(text: string): FunctionCalls[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error('SQL coverage file is not a list');
  return value.map((row: unknown) => {
    if (typeof row !== 'object' || row === null) throw new Error('Bad SQL coverage row');
    const { name, calls } = row as Record<string, unknown>;
    if (typeof name !== 'string' || typeof calls !== 'number') {
      throw new Error('Bad SQL coverage row');
    }
    return { name, calls };
  });
}

export function mergeCalls(
  full: FunctionCalls[][],
  partial: FunctionCalls[][] = [],
): Map<string, number> {
  const merged = new Map<string, number>();
  for (const row of full.flat()) merged.set(row.name, (merged.get(row.name) ?? 0) + row.calls);
  for (const row of partial.flat()) {
    const calls = merged.get(row.name);
    if (calls !== undefined) merged.set(row.name, calls + row.calls);
  }
  return merged;
}

/** Dumps of databases stopped at an older migration carry this file name prefix. */
export const PARTIAL_PREFIX = 'partial-';

export function uncalled(merged: Map<string, number>): string[] {
  return [...merged]
    .filter(([, calls]) => calls === 0)
    .map(([name]) => name)
    .sort();
}

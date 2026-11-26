// Turns what the database returns into rows for the review screen, for a new draft and for a
// saved one.
import { importRowError } from './row-error.ts';
import type { ImportRow, Staged } from '../api/import.ts';
import { suggestion, type Candidate, type Choice, type ReviewRow } from './decisions.ts';
import type { StagedRow } from './rows.ts';
import type { Edited } from './values.ts';

/** Staged rows come back in the order they were sent, each with its id and candidates. */
export function freshRows(staged: Staged, sent: readonly StagedRow[]): ReviewRow[] {
  return (staged.rows ?? []).map(({ row_id, candidates }, i) => {
    const row = sent[i];
    const issues = row?.issues ?? [];
    return {
      rowId: row_id,
      rowNumber: row?.row_number ?? i + 1,
      raw: row?.raw ?? {},
      edited: row?.edited ?? {},
      issues,
      candidates,
      choice: suggestion(candidates, issues),
    };
  });
}

function editedOf(row: ImportRow): Edited {
  const edited: Edited = {};
  for (const [key, value] of Object.entries(row.edited ?? {})) {
    if (typeof value === 'string') (edited as Record<string, string>)[key] = value;
  }
  return edited;
}

function savedChoice(row: ImportRow, candidates: Candidate[]): Choice {
  if (row.decision === 'link' && row.target_supplier_id) {
    return { decision: 'link', target: row.target_supplier_id };
  }
  if (row.decision === 'new') return { decision: 'new' };
  return suggestion(candidates, row.edited?.name ? [] : [{ field: 'name', text: 'חסר שם' }]);
}

/** The pending rows of a saved draft, with fresh candidates and any decision saved earlier. */
export function draftRows(staged: Staged, rows: readonly ImportRow[]): ReviewRow[] {
  const candidates = new Map((staged.rows ?? []).map((r) => [r.row_id, r.candidates]));
  return rows
    .filter((row) => row.status === 'pending')
    .map((row) => {
      const found = candidates.get(row.id) ?? [];
      return {
        rowId: row.id,
        rowNumber: row.row_number,
        raw: row.raw,
        edited: editedOf(row),
        issues: row.error ? [{ field: 'name' as const, text: importRowError(row.error) }] : [],
        candidates: found,
        choice: savedChoice(row, found),
      };
    });
}

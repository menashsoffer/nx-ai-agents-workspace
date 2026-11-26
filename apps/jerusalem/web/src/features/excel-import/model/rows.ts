// From a sheet of text cells to the rows sent to stage_excel_import (spec section 6, steps 1-3).
import type { Field } from './columns.ts';
import { cleanCell } from './safety.ts';
import { editedRow, type Edited, type Issue } from './values.ts';

export const MAX_ROWS = 5000;
export const MAX_BYTES = 5 * 1024 * 1024;

export interface Table {
  headers: string[];
  /** Data rows with their row number in the sheet, counted from 1 as Excel shows it. */
  rows: { number: number; cells: string[] }[];
}

/** The first non-empty row holds the headers; empty rows after it are skipped. */
export function tableOf(source: string[][]): Table {
  const sheet = source.map((row) => row.map(cleanCell));
  const start = sheet.findIndex((row) => row.some(Boolean));
  if (start < 0) return { headers: [], rows: [] };
  const headers = (sheet[start] ?? []).map((h, i) => h || `עמודה ${String(i + 1)}`);
  const rows = sheet
    .slice(start + 1)
    .map((cells, i) => ({ number: start + i + 2, cells }))
    .filter((row) => row.cells.some(Boolean));
  return { headers, rows };
}

export interface StagedRow {
  row_number: number;
  raw: Record<string, string>;
  edited: Edited;
  issues: Issue[];
}

/** Every non-empty cell under its own header in `raw`; mapped fields checked into `edited`. */
export function stagedRows(table: Table, mapping: readonly (Field | null)[]): StagedRow[] {
  return table.rows.map(({ number, cells }) => {
    const raw: Record<string, string> = {};
    const mapped: Partial<Record<Field, string>> = {};
    table.headers.forEach((header, i) => {
      const value = cells[i] ?? '';
      if (!value) return;
      raw[header] = value;
      const field = mapping[i];
      if (field) mapped[field] = value;
    });
    return { row_number: number, raw, ...editedRow(mapped) };
  });
}

/** SHA-256 of the file as lowercase hex, with the browser's own Web Crypto. */
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

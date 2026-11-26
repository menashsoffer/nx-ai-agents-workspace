// The state of each document kind and the checks before upload (supplier-portal-spec-he.md 6.5).
import { dayOf } from '../../../lib/dates.ts';
import { DOCUMENT_LABELS, type DocumentKind } from './kinds.ts';
import type { DocumentList, SupplierDocument } from '../api/documents.ts';
import { plusDays } from './portal-model.ts';

/** 30 days before a document ends, the file shows a task card (spec 6.5). */
export const ENDING_DAYS = 30;

export type DocumentState = 'missing' | 'pending' | 'valid' | 'ending' | 'expired' | 'rejected';

export interface KindRow {
  kind: DocumentKind;
  state: DocumentState;
  /** The approved document in force, if any. */
  current: SupplierDocument | undefined;
  /** The newest upload, when it waits or was rejected after the current one. */
  latest: SupplierDocument | undefined;
}

function stateOf(current: SupplierDocument | undefined, today: string): DocumentState {
  if (!current) return 'missing';
  if (current.valid_until < today) return 'expired';
  return current.valid_until <= plusDays(today, ENDING_DAYS) ? 'ending' : 'valid';
}

/** One row per kind asked of the supplier. A waiting or rejected newer upload shows first. */
export function documentRows(list: DocumentList, today: string): KindRow[] {
  return list.kinds.map((kind) => {
    const ofKind = list.documents.filter((d) => d.kind === kind);
    const current = ofKind.find((d) => d.status === 'approved');
    const [newest] = ofKind;
    const latest = newest && newest.status !== 'approved' ? newest : undefined;
    const state = stateOf(current, today);
    const shown: DocumentState =
      latest?.status === 'pending' ? 'pending' : latest ? 'rejected' : state;
    return { kind, state: shown, current, latest };
  });
}

/** The status sentence of one row, as the spec words it. */
export function rowText(row: KindRow): string {
  const until = row.current ? dayOf(row.current.valid_until) : '';
  switch (row.state) {
    case 'missing':
      return 'חסר';
    case 'pending':
      return 'בבדיקה';
    case 'valid':
      return `בתוקף עד ${until}`;
    case 'ending':
      return `בתוקף עד ${until}, כדאי להעלות חדש`;
    case 'expired':
      return `פג תוקף ב-${until}`;
    case 'rejected':
      return `נדחה${row.latest?.review_note ? `: ${row.latest.review_note}` : ''}`;
  }
}

/** A valid-until date from today up to ten years ahead, as the database checks it. */
export function untilProblem(value: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'צריך לבחור תאריך תוקף.';
  const limit = `${String(Number(today.slice(0, 4)) + 10)}${today.slice(4)}`;
  if (value < today || value > limit) return 'תאריך התוקף צריך להיות מהיום ועד עשר שנים קדימה.';
  return null;
}

const URGENT: DocumentState[] = ['expired', 'rejected', 'ending'];

/** The text of the documents card in "מה חסר לי", or null when every document is in order. */
export function documentsTaskText(rows: KindRow[]): string | null {
  const urgent = rows.filter((r) => URGENT.includes(r.state));
  const [first] = urgent.sort((a, b) => URGENT.indexOf(a.state) - URGENT.indexOf(b.state));
  if (first) {
    const label = DOCUMENT_LABELS[first.kind];
    const until = first.current ? dayOf(first.current.valid_until) : '';
    const text =
      first.state === 'expired'
        ? `${label} פג ב-${until}`
        : first.state === 'ending'
          ? `${label} מסתיים ב-${until}`
          : `${label} נדחה`;
    return urgent.length > 1 ? `${text}, ועוד ${String(urgent.length - 1)}` : text;
  }
  const missing = rows.filter((r) => r.state === 'missing').length;
  if (missing === 0) return null;
  return missing === 1 ? 'חסר מסמך אחד' : `חסרים ${String(missing)} מסמכים`;
}

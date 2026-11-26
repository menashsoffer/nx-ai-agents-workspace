import type { RuleKey } from './messages.ts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Registry dates the system can hold; anything outside is a typing mistake. */
export const EARLIEST = '1990-01-01';
export const LATEST = '2100-12-31';

/** A real calendar day as `YYYY-MM-DD` (2026-02-30 is not one). */
export function realDate(value: string): boolean {
  if (!ISO.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

export function dateProblem(value: string, latest = LATEST): RuleKey | null {
  if (!value) return 'required';
  if (!realDate(value)) return 'bad_date';
  if (value < EARLIEST || value > LATEST) return 'date_range';
  return value > latest ? 'date_future' : null;
}

/** Both dates optional; when both exist the end may not come before the start. */
export function datesOrderProblem(from: string | null, until: string | null): RuleKey | null {
  return from && until && until < from ? 'dates_order' : null;
}

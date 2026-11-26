// Pure wording and order for the registry verification screens.
import { dateLabel } from '../../../lib/dates.ts';
import type { Member, RegistryReview } from '../api/registries.ts';

type Counts = RegistryReview['counts'];

export const STATUS_LABELS: Record<Member['review_status'], string> = {
  needs_review: 'ממתין לבדיקה',
  verified: 'אומת',
  rejected: 'נדחה',
};

/** "12 מתוך 40 נבדקו" — rejected rows count as checked too. */
export function progress(counts: Counts): string {
  const done = counts.verified + counts.rejected;
  return `${String(done)} מתוך ${String(done + counts.needs_review)} נבדקו`;
}

export function untilText(until: string | null): string {
  return until ? `בתוקף עד ${dateLabel(until)}` : 'אין תאריך תוקף';
}

/** Waiting rows first, then by page in the document. */
export function reviewOrder(members: readonly Member[]): Member[] {
  const rank = (m: Member) => (m.review_status === 'needs_review' ? 0 : 1);
  return [...members].sort(
    (a, b) => rank(a) - rank(b) || (a.source_page ?? 1e9) - (b.source_page ?? 1e9),
  );
}

/** The supplier's own end date wins; otherwise the registry's (Menash, 25.11). */
export function memberUntil(member: Member, registryUntil: string | null): string {
  if (member.registered_until) return `עד ${dateLabel(member.registered_until)} (תאריך של הספק)`;
  return registryUntil ? `עד ${dateLabel(registryUntil)} (לפי המאגר)` : 'בלי תאריך';
}

/** A YYYY-MM-DD string from the date field, or null when it is empty or not a date. */
export function dateInput(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

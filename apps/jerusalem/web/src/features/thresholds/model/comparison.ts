import type { Proposal, Threshold } from '../api/proposals.ts';
export const AMOUNT_LABELS = {
  no_tender_max: 'ללא מכרז',
  zuta4_max: 'מכרז זוטא — ארבע הצעות',
  zuta6_max: 'מכרז זוטא — שש הצעות',
} as const;
export function previousThreshold(proposal: Proposal, thresholds: Threshold[]): Threshold | null {
  const before = new Date(`${proposal.valid_from}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  return thresholdOn(before.toISOString().slice(0, 10), thresholds);
}
const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
export function formatMoney(amount: number): string {
  return money.format(amount);
}
export function monthLabel(date: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** The thresholds in force on `day` (YYYY-MM-DD): the latest one whose range covers it. */
export function thresholdOn(day: string, thresholds: Threshold[]): Threshold | null {
  return (
    thresholds
      .filter((t) => t.valid_from <= day && (t.valid_until === null || t.valid_until >= day))
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] ?? null
  );
}
const percent = new Intl.NumberFormat('he-IL', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});
/** The change from the current amount to the proposed one, as "+0.4%" (direction-safe). */
export function changeLabel(current: number, proposed: number): string {
  return `⁦${percent.format((proposed - current) / current)}⁩`;
}

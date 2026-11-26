// Approaches and their answers on the staff side (supplier-approaches-spec-he.md 6).
import { money } from './result.ts';

export const CHANNELS = ['email', 'phone', 'portal', 'letter', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'דוא״ל',
  phone: 'טלפון',
  portal: 'האזור האישי',
  letter: 'מכתב',
  other: 'אחר',
};

export const DECLINE_LABELS: Record<string, string> = {
  no_capacity: 'אין זמינות',
  not_our_field: 'התחום לא מתאים',
  too_short: 'המועד קצר מדי',
  other: 'אחר',
};

/** The engine's VAT rate, used only to compare offers given with and without VAT. */
export const VAT_RATE = 0.18;

export function plusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The deadline the dialog offers, and the range the database accepts (spec 6.1). */
export function deadlineRange(today: string) {
  return { initial: plusDays(today, 7), min: plusDays(today, 1), max: plusDays(today, 90) };
}

export interface ApproachAnswer {
  answer: 'offer' | 'declined';
  decline_reason: string | null;
  source: 'portal' | 'staff';
  offer_amount?: number | null | undefined;
  offer_includes_vat?: boolean | null | undefined;
  note?: string | null | undefined;
  file_path?: string | null | undefined;
}

/** The answer in words; an offer shows its amount only once it is opened. */
export function answerText(answer: ApproachAnswer | null): string {
  if (!answer) return 'ממתין לתשובה';
  const by = answer.source === 'staff' ? ' (נרשם בידי העירייה)' : '';
  if (answer.answer === 'declined') {
    const reason = DECLINE_LABELS[answer.decline_reason ?? ''] ?? 'אחר';
    return `לא מעוניין: ${reason}${answer.note ? `, ${answer.note}` : ''}${by}`;
  }
  if (answer.offer_amount === null || answer.offer_amount === undefined) return `הגיש הצעה${by}`;
  const vat = answer.offer_includes_vat ? 'כולל מע״מ' : 'לא כולל מע״מ';
  return `הצעה: ${money(answer.offer_amount)} ${vat}${by}`;
}

/** An opened offer as an amount including VAT, for sorting only; null when there is none. */
export function comparable(answer: ApproachAnswer | null): number | null {
  const amount = answer?.answer === 'offer' ? answer.offer_amount : null;
  if (amount === null || amount === undefined) return null;
  return answer?.offer_includes_vat ? amount : Math.round(amount * (1 + VAT_RATE) * 100) / 100;
}

/** A YYYY-MM-DD day as "29.11.2026". */
export function shortDay(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`;
}

/** The day after the deadline, when sealed offers open. */
export const opensOn = (respondBy: string) => shortDay(plusDays(respondBy, 1));

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

/** An amount as typed, without thousands commas. */
export const cleanAmount = (raw: string) => raw.trim().replaceAll(',', '');

/** The same rule the database keeps: positive, up to two decimals. */
export function amountProblem(raw: string): string | null {
  const value = cleanAmount(raw);
  return AMOUNT.test(value) && Number(value) > 0
    ? null
    : 'כתבו סכום חיובי בספרות, עם עד שתי ספרות אחרי הנקודה.';
}

interface Recordable {
  channel: Channel;
  approached_on: string;
  respond_by: string | null;
  answer: unknown;
}

/** Staff record an answer that came outside the area while the approach is open (spec 6.3). */
export function recordable(row: Recordable, today: string): boolean {
  return row.channel !== 'portal' && !row.answer && (!row.respond_by || today <= row.respond_by);
}

/** The day the answer came: from the approach day to today, and not after the deadline. */
export function receivedRange(row: Recordable, today: string) {
  const max = row.respond_by && row.respond_by < today ? row.respond_by : today;
  return { min: row.approached_on, max };
}

/** The days a deadline may move to: after the latest open one, from tomorrow up to 90 days. */
export function extendRange(
  rows: readonly { respond_by: string | null; sealed: boolean }[],
  today: string,
): { min: string; max: string } | null {
  const [latest] = rows
    .filter((row) => row.sealed)
    .map((row) => row.respond_by ?? '')
    .sort()
    .reverse();
  if (!latest) return null;
  const after = plusDays(latest, 1);
  const tomorrow = plusDays(today, 1);
  return { min: after > tomorrow ? after : tomorrow, max: plusDays(today, 90) };
}

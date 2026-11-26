// The supplier's approaches in three groups, and the checks before an answer is sent
// (supplier-approaches-spec-he.md 5). The database repeats every check.
import type { Approach } from '../api/approaches.ts';

export type ApproachGroup = 'waiting' | 'answered' | 'closed';

export const GROUP_TITLES: Record<ApproachGroup, string> = {
  waiting: 'מחכות לתשובה',
  answered: 'עניתם',
  closed: 'נסגרו',
};

export const DECLINE_REASONS = [
  ['no_capacity', 'אין לנו זמינות'],
  ['not_our_field', 'התחום לא מתאים לנו'],
  ['too_short', 'המועד קצר מדי'],
  ['other', 'אחר'],
] as const;

const URGENT_DAYS = 3;

/** The answer that counts: the latest one, unless it was withdrawn. */
export const currentAnswer = (approach: Approach) =>
  approach.answer && !approach.answer.withdrawn_at ? approach.answer : null;

export function groupOf(approach: Approach): ApproachGroup {
  if (approach.cancelled || approach.result) return 'closed';
  if (currentAnswer(approach)) return 'answered';
  return approach.open ? 'waiting' : 'closed';
}

/** Newest first within each group (the database already sorts them so). */
export function grouped(list: readonly Approach[]): Record<ApproachGroup, Approach[]> {
  const groups: Record<ApproachGroup, Approach[]> = { waiting: [], answered: [], closed: [] };
  for (const approach of list) groups[groupOf(approach)].push(approach);
  return groups;
}

export function daysLeft(respondBy: string, today: string): number {
  return Math.round((Date.parse(respondBy) - Date.parse(today)) / 86_400_000);
}

/** "נותרו 3 ימים", or "היום עד 23:59" on the last day; urgent under three days. */
export function dueText(respondBy: string, today: string): { text: string; urgent: boolean } {
  const left = daysLeft(respondBy, today);
  const text =
    left <= 0 ? 'היום עד 23:59' : left === 1 ? 'נותר יום אחד' : `נותרו ${String(left)} ימים`;
  return { text, urgent: left < URGENT_DAYS };
}

/** A YYYY-MM-DD day as "29.11.2026". */
export function shortDay(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`;
}

/** What the group "עניתם" or "נסגרו" says about the approach. */
export function stateText(approach: Approach): string {
  if (approach.cancelled) return 'היחידה ביטלה את הבקשה';
  if (approach.result === 'selected') return 'ההצעה שלכם נבחרה';
  if (approach.result === 'not_selected') return 'ההצעה שלכם לא נבחרה. היחידה בחרה הצעה אחרת';
  const answer = currentAnswer(approach);
  if (!answer) return 'המועד עבר בלי תשובה';
  if (answer.answer === 'declined') return 'השבתם שאינכם מעוניינים';
  return `הגשתם הצעה ב-${shortDay(answer.created_at.slice(0, 10))}`;
}

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/u;

/** The amount as the database takes it, or the problem with it. */
export function amountProblem(raw: string): string | null {
  const value = raw.trim().replaceAll(',', '');
  if (!AMOUNT.test(value) || Number(value) <= 0) {
    return 'כתבו סכום חיובי בספרות, עם עד שתי ספרות אחרי הנקודה.';
  }
  return null;
}

export const cleanAmount = (raw: string) => raw.trim().replaceAll(',', '');

/** The line shown before an offer is sent (spec 5.2). */
export function offerSummary(amount: string, includesVat: boolean, approach: Approach): string {
  const sum = Number(cleanAmount(amount)).toLocaleString('he-IL');
  const vat = includesVat ? 'כולל מע״מ' : 'לא כולל מע״מ';
  return `הצעה של ${sum} ₪ ${vat} ל"${approach.subject}". העירייה תראה אותה אחרי ${shortDay(approach.respond_by)}.`;
}

/** The "מה חסר לי" line for approaches that wait, with the nearest deadline. */
export function waitingTaskText(list: readonly Approach[]): string | null {
  const waiting = list.filter((a) => groupOf(a) === 'waiting');
  const [nearest] = waiting.map((a) => a.respond_by).sort();
  if (nearest === undefined) return null;
  const due = shortDay(nearest);
  return waiting.length === 1
    ? `פנייה אחת מחכה לתשובה, עד ${due}`
    : `יש ${String(waiting.length)} פניות שמחכות לתשובה, הקרובה עד ${due}`;
}

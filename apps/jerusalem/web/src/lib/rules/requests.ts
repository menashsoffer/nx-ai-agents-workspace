import type { RuleKey } from './messages.ts';
import { textProblem } from './text.ts';

/** Engagement requests and decision notes (documentation/validation-rules-he.md, section 2). */
export const subjectProblem = (value: string) =>
  textProblem(value, { min: 3, max: 500, letters: 2 });

/** Shekels with up to two decimals, more than zero and below the column's 14 digits. */
export function amountProblem(value: string): RuleKey | null {
  if (!value) return 'required';
  const plain = value.replaceAll(',', '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(plain) || Number(plain) <= 0) return 'bad_amount';
  return null;
}

export function exemptionProblem(value: string): RuleKey | null {
  if (!value) return 'required';
  return /^3\(\d+א?\)$/.test(value) ? null : 'bad_exemption';
}

export const noteProblem = (value: string) => textProblem(value, { min: 2, max: 2000, letters: 2 });

/**
 * A rejection always needs a reason. `noteAlways` is for category requests, where the
 * table requires a note for every decision.
 */
export function decisionNoteProblem(decision: string, note: string, noteAlways = false) {
  if (!note) return decision === 'rejected' || noteAlways ? 'required' : null;
  return noteProblem(note);
}

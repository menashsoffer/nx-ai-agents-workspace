import { z } from 'zod';
import type { RuleKey } from './messages.ts';

/**
 * Building blocks shared by every rule. Each pattern has a twin in
 * supabase/migrations/*_validation_rules.sql; tests/rule-cases.ts runs both on the same values.
 */
export const LETTER = /[A-Za-zא-ת]/g;
// Control characters are exactly what this pattern must find.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const REPEATED = /(.)\1{4,}/;

export function letters(value: string): number {
  return value.match(LETTER)?.length ?? 0;
}

interface TextLimits {
  min: number;
  max: number;
  /** Fewest Hebrew or Latin letters a real value has. */
  letters: number;
}

/** First rule a free text breaks, in the same order as the SQL check. */
export function textProblem(value: string, limits: TextLimits): RuleKey | null {
  if (!value) return 'required';
  if (CONTROL.test(value)) return 'control_chars';
  if (value.length < limits.min) return 'too_short';
  if (value.length > limits.max) return 'too_long';
  if (letters(value) < limits.letters) return 'needs_letters';
  if (REPEATED.test(value)) return 'repeated';
  return null;
}

/** Trimmed text with inner runs of spaces collapsed, as the database stores it. */
export const cleanText = z.string().transform((value) => value.trim().replace(/\s+/g, ' '));

/** A zod schema from a problem function: the issue message is the rule key. */
export function ruled(problem: (value: string) => RuleKey | null) {
  return cleanText.superRefine((value, context) => {
    const key = problem(value);
    if (key) context.addIssue({ code: 'custom', message: key });
  });
}

/** Optional text: empty becomes null, anything else must pass the rule. */
export function optional(problem: (value: string) => RuleKey | null) {
  return ruled((value) => (value ? problem(value) : null)).transform((value) => value || null);
}

import { z } from 'zod';
import { validCheckDigit } from './israeli-id.ts';
import type { RuleKey } from './messages.ts';
import { cleanText, optional, ruled, textProblem } from './text.ts';

/** Every supplier write rule (documentation/validation-rules-he.md, section 1). */
export const nameProblem = (value: string) => textProblem(value, { min: 2, max: 300, letters: 1 });

const PHONE = [
  /^0(5\d|7\d)\d{7}$/, // mobile and VoIP, 10 digits
  /^0[2-489]\d{7}$/, // landline, 9 digits
  /^1(700|800|599|801)\d{6}$/, // national numbers
  /^\*\d{4}$/, // star numbers
  /^\+(?!972)[1-9]\d{7,14}$/, // abroad
];
/** Spaces, dashes, dots and brackets are layout; +972 is the leading 0. */
export function phoneDigits(value: string): string {
  return value.replace(/[\s\-().]/g, '').replace(/^\+972/, '0');
}
export function phoneProblem(value: string): RuleKey | null {
  if (!value) return 'required';
  return PHONE.some((pattern) => pattern.test(phoneDigits(value))) ? null : 'bad_phone';
}

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
export function emailProblem(value: string): RuleKey | null {
  if (!value) return 'required';
  if (value.length > 254) return 'too_long';
  return EMAIL.test(value) ? null : 'bad_email';
}

const WEBSITE = /^(https?:\/\/)?([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(:\d{2,5})?(\/\S*)?$/;
export function websiteProblem(value: string): RuleKey | null {
  if (!value) return 'required';
  if (value.length > 500) return 'too_long';
  return WEBSITE.test(value) ? null : 'bad_website';
}

export const addressProblem = (value: string) =>
  textProblem(value, { min: 5, max: 300, letters: 2 });

export function personProblem(value: string): RuleKey | null {
  if (value.includes('@')) return 'has_at';
  return textProblem(value, { min: 2, max: 100, letters: 2 });
}

export const CONTACT_RULES = {
  phone: phoneProblem,
  email: emailProblem,
  website: websiteProblem,
  address: addressProblem,
  contact_person: personProblem,
} as const;
export type ContactKind = keyof typeof CONTACT_RULES;
export const contactKind = z.enum(['phone', 'email', 'website', 'address', 'contact_person'], {
  message: 'bad_choice',
});

const IDENTIFIER_SHAPE = {
  company: /^5\d{8}$/,
  nonprofit: /^58\d{7}$/,
  vat_dealer: /^\d{5,9}$/,
} as const;
export type IdentifierScheme = keyof typeof IDENTIFIER_SHAPE;
export const identifierScheme = z.enum(['company', 'nonprofit', 'vat_dealer'], {
  message: 'bad_choice',
});
export function identifierProblem(scheme: IdentifierScheme, value: string): RuleKey | null {
  if (!value) return 'required';
  if (!IDENTIFIER_SHAPE[scheme].test(value)) return 'bad_identifier';
  return validCheckDigit(value) ? null : 'bad_check_digit';
}

export const supplierName = ruled(nameProblem);
export const reasonProblem = (value: string) =>
  textProblem(value, { min: 3, max: 500, letters: 2 });
export const sourceProblem = (value: string) =>
  textProblem(value, { min: 2, max: 500, letters: 2 });
export const statusReason = ruled(reasonProblem);
export const statusSource = optional(sourceProblem);
export { cleanText };

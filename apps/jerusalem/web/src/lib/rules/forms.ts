import { z } from 'zod';
import { dateProblem, datesOrderProblem } from './dates.ts';
import { isRuleKey, RULE_MESSAGES } from './messages.ts';
import {
  CONTACT_RULES,
  cleanText,
  contactKind,
  emailProblem,
  identifierProblem,
  identifierScheme,
  phoneProblem,
  statusReason,
  statusSource,
  supplierName,
} from './supplier.ts';
import { optional, ruled } from './text.ts';
import {
  amountProblem,
  decisionNoteProblem,
  exemptionProblem,
  subjectProblem,
} from './requests.ts';

/** The schemas behind each supplier write form; the database runs the same checks again. */
export const renameForm = z.object({ display_name: supplierName });

export const contactForm = z
  .object({ kind: contactKind, value: cleanText })
  .superRefine(({ kind, value }, context) => {
    const key = CONTACT_RULES[kind](value);
    if (key) context.addIssue({ code: 'custom', path: ['value'], message: key });
  });

/** The edit dialog: the name and every contact that changed, saved together. */
export const supplierEditForm = z.object({
  display_name: supplierName,
  contacts: z.array(
    z
      .object({ contact_id: z.string(), kind: contactKind, value: cleanText })
      .superRefine(({ kind, value }, context) => {
        const key = CONTACT_RULES[kind](value);
        if (key) context.addIssue({ code: 'custom', path: ['value'], message: key });
      }),
  ),
});

export function statusForm(today: string) {
  return z.object({
    reason: statusReason,
    source: statusSource,
    changed_on: ruled((value) => dateProblem(value, today)),
  });
}

const optionalDate = optional((value) => dateProblem(value));
const ENTITY_KINDS = [
  'company',
  'sole_trader',
  'nonprofit',
  'partnership',
  'public_body',
  'cooperative',
  'unknown',
  '',
] as const;
const entityKind = z.enum(ENTITY_KINDS, {
  message: 'bad_choice',
});

export const membershipForm = z
  .object({
    display_name: supplierName,
    entity_kind: entityKind,
    identifier_scheme: z.union([identifierScheme, z.literal('')]),
    identifier: cleanText,
    registered_from: optionalDate,
    registered_until: optionalDate,
    engagement_started_on: optionalDate,
    phone: optional(phoneProblem),
    email: optional(emailProblem),
  })
  .superRefine((form, context) => {
    const issue = (path: string, message: string) => {
      context.addIssue({ code: 'custom', path: [path], message });
    };
    if (!form.identifier_scheme !== !form.identifier) issue('identifier', 'identifier_pair');
    else if (form.identifier_scheme) {
      const key = identifierProblem(form.identifier_scheme, form.identifier);
      if (key) issue('identifier', key);
    }
    const order = datesOrderProblem(form.registered_from, form.registered_until);
    if (order) issue('registered_until', order);
  });

/** The route-check form; a subject is needed only when the request is saved to a unit. */
export const draftForm = z
  .object({
    subject: cleanText,
    estimated_value: ruled(amountProblem).transform((value) => Number(value.replaceAll(',', ''))),
    requested_exemption: optional(exemptionProblem),
    unit_id: cleanText,
  })
  .superRefine(({ subject, unit_id: unit }, context) => {
    const key = unit || subject ? subjectProblem(subject) : null;
    if (key) context.addIssue({ code: 'custom', path: ['subject'], message: key });
  });

export function decisionNote(decision: string, noteAlways = false) {
  return z.object({ note: ruled((value) => decisionNoteProblem(decision, value, noteAlways)) });
}

export type FieldErrors = Record<string, string>;
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/** Runs a schema on form text and turns rule keys into Hebrew messages per field. */
/** Field paths join with dots: `contacts.0.value`. */
export function check<T>(schema: z.ZodType<T>, input: unknown): Checked<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.map(String).join('.') || 'form';
    errors[field] ??= isRuleKey(issue.message)
      ? RULE_MESSAGES[issue.message]
      : RULE_MESSAGES.required;
  }
  return { ok: false, errors };
}

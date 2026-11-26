import { z } from 'zod';
import {
  accessReasonProblem,
  jobTitleProblem,
  personNameProblem,
} from '../../../lib/rules/access.ts';
import { phoneProblem } from '../../../lib/rules/supplier.ts';
import { cleanText, optional, ruled } from '../../../lib/rules/text.ts';

/** The forms on the account screen (screens-spec 4 and 4.1); the database checks them again. */
const personName = ruled(personNameProblem);
const jobTitle = ruled(jobTitleProblem);
const reason = ruled(accessReasonProblem);
const choice = z.string().min(1, { message: 'required' });

export const accessForm = z.object({
  first_name: personName,
  last_name: personName,
  job_title: jobTitle,
  unit_id: choice,
  phone: optional(phoneProblem),
  purpose: reason,
});
export type AccessInput = z.infer<typeof accessForm>;

export const detailsForm = z.object({
  first_name: personName,
  last_name: personName,
  job_title: jobTitle,
  phone: optional(phoneProblem),
  reason,
});
export type DetailsInput = z.infer<typeof detailsForm>;

const ROLES = ['viewer', 'editor', 'unit_manager', 'admin', 'auditor'] as const;
const UNITLESS: readonly string[] = ['admin', 'auditor'];

interface ChangeFields {
  kind: string;
  role: string;
  unit_id: string;
  grant_id: string;
}
/** The fields a change of this kind still needs. */
function missing({ kind, role, unit_id, grant_id }: ChangeFields): string[] {
  if (kind === 'add_role') {
    if (!role) return ['role'];
    return !UNITLESS.includes(role) && !unit_id ? ['unit_id'] : [];
  }
  if (kind === 'move_unit') return unit_id ? [] : ['unit_id'];
  if (kind === 'remove_role') return grant_id ? [] : ['grant_id'];
  return [];
}

const KINDS = ['add_role', 'remove_role', 'move_unit'] as const;
const isKind = (value: string): value is (typeof KINDS)[number] =>
  (KINDS as readonly string[]).includes(value);
const isRole = (value: string): value is (typeof ROLES)[number] =>
  (ROLES as readonly string[]).includes(value);

/** What to ask for decides which of role, unit and grant are needed; every miss shows at once. */
export const changeForm = z
  .object({
    kind: z.string().default(''),
    role: z.string().default(''),
    unit_id: z.string().default(''),
    grant_id: z.string().default(''),
    reason: cleanText,
  })
  .superRefine((value, context) => {
    const problems: [string, string | null][] = [
      ['kind', isKind(value.kind) ? null : 'required'],
      ['role', value.role && !isRole(value.role) ? 'bad_choice' : null],
      ['reason', accessReasonProblem(value.reason)],
      ...missing(value).map((path): [string, string] => [path, 'required']),
    ];
    for (const [path, message] of problems) {
      if (message) context.addIssue({ code: 'custom', path: [path], message });
    }
  })
  .transform((value) => ({
    ...value,
    kind: isKind(value.kind) ? value.kind : 'add_role',
    role: isRole(value.role) ? value.role : ('' as const),
  }));
export type ChangeInput = z.infer<typeof changeForm>;

/** Only the fields that differ from the profile go into the request. */
export function changedDetails(
  input: DetailsInput,
  current: { first_name: string; last_name: string; job_title: string; phone: string | null },
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const key of ['first_name', 'last_name', 'job_title'] as const) {
    if (input[key] !== current[key]) next[key] = input[key];
  }
  if ((input.phone ?? '') !== (current.phone ?? '')) next.phone = input.phone ?? '';
  return next;
}

/** Form values as strings, for zod. */
export function formValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === 'string') values[key] = value;
  });
  return values;
}

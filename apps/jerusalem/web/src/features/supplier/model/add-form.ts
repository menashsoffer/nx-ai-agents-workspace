import type { RegistryOption, WriteContext } from '../../../data/write-context.ts';
import { check, membershipForm } from '../../../lib/rules/forms.ts';

/** The form fields that `save_supplier_membership` accepts, in the order the form shows them. */
const FIELDS = [
  'display_name',
  'entity_kind',
  'identifier_scheme',
  'identifier',
  'registry_version_id',
  'registry_field_id',
  'registered_from',
  'registered_until',
  'engagement_started_on',
  'phone',
  'email',
] as const;

const LABELS: Record<string, string> = {
  display_name: 'שם ספק',
  entity_kind: 'סוג ישות',
  identifier_scheme: 'סוג מזהה',
  identifier: 'מספר מזהה',
  registered_from: 'תחילת רישום',
  registered_until: 'סיום רישום',
  engagement_started_on: 'תחילת התקשרות',
  phone: 'טלפון',
  email: 'דוא״ל',
};

/** The shared rules (lib/rules) on every field; each mistake is named by its field. */
function rulesMessage(payload: AddPayload): string {
  const checked = check(membershipForm, payload);
  if (checked.ok) return '';
  return Object.entries(checked.errors)
    .map(([field, message]) => `${LABELS[field] ?? field}: ${message}`)
    .join(' ');
}

export function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** Present in the form only while similar suppliers are offered. */
export const OFFERED_FIELD = 'duplicates_offered';

export type AddPayload = Record<string, string>;
export type ParsedForm = { payload: AddPayload; error: '' } | { payload: null; error: string };

/**
 * Builds the request from the submitted form. When similar suppliers were offered, the user must
 * pick one of them or explicitly choose a new supplier; a similar name is never merged silently.
 */
export function parseAddForm(form: FormData): ParsedForm {
  const payload: AddPayload = {};
  for (const key of FIELDS) payload[key] = formText(form, key);
  const problems = rulesMessage(payload);
  if (problems) return { payload: null, error: problems };
  const choice = formText(form, 'supplier_choice');
  if (form.has(OFFERED_FIELD) && !choice)
    return { payload: null, error: 'יש לבחור ספק קיים או יצירה חדשה.' };
  if (choice && choice !== 'new') payload.supplier_id = choice;
  return { payload, error: '' };
}

/** The pool name, plus dates and a missing source only when they tell versions apart. */
export function versionLabel(version: RegistryOption): string {
  const parts = [version.name];
  if (version.validFrom || version.validUntil)
    parts.push(`${version.validFrom ?? 'ללא תחילה'} – ${version.validUntil ?? 'ללא סיום'}`);
  if (!version.hasSource) parts.push('ללא מסמך מקור');
  return parts.join(' · ');
}

/** The fields of the chosen pool version, by the text that appears in the source document. */
export function fieldsOf(context: WriteContext, versionId: string) {
  const version = context.versions.find((item) => item.versionId === versionId);
  if (!version) return [];
  return context.catalog.fields.filter((field) => field.registry_id === version.registryId);
}

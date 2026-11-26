import { check, draftForm } from '../../../lib/rules/forms.ts';
import type { Draft } from './result.ts';

export interface DraftFields {
  draft: Draft;
  unitId: string;
  subject: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

const LABELS: Record<string, string> = {
  subject: 'נושא',
  estimated_value: 'אומדן',
  requested_exemption: 'פטור מבוקש',
};

/** Reads the request form with the shared rules. Returns a Hebrew message for each mistake. */
export function readDraft(form: FormData): DraftFields | string {
  const checked = check(draftForm, {
    subject: text(form, 'subject'),
    estimated_value: text(form, 'estimated_value'),
    requested_exemption: text(form, 'requested_exemption'),
    unit_id: text(form, 'unit_id'),
  });
  if (!checked.ok) {
    return Object.entries(checked.errors)
      .map(([field, message]) => `${LABELS[field] ?? field}: ${message}`)
      .join(' ');
  }
  const { subject, estimated_value: amount, requested_exemption: exemption } = checked.value;
  const draft = {
    estimated_value: amount,
    value_includes_vat: form.get('value_includes_vat') === 'on',
    requested_exemption: exemption,
  };
  return { draft, unitId: checked.value.unit_id, subject };
}

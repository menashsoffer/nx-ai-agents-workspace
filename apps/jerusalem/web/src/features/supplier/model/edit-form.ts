import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import type { SupplierChange } from '../../../data/supplier-changes.ts';
import { check, supplierEditForm, type FieldErrors } from '../../../lib/rules/forms.ts';
import { RULE_MESSAGES } from '../../../lib/rules/messages.ts';
import { formText } from './add-form.ts';
import { ENTITY_KINDS } from './labels.ts';

/** Form field names: the name, one input per current contact, and one new contact. */
export const NAME = 'display_name';
export const KIND = 'entity_kind';
export const REASON = 'change_reason';
export const NEW_KIND = 'new_kind';
export const NEW_VALUE = 'new_value';
export const contactField = (id: string) => `contact:${id}`;
/** Set to "1" by the trash can beside a contact: save deletes it. */
export const removeField = (id: string) => `remove:${id}`;

type Contact = SupplierDetail['contacts'][number];
export type EditResult =
  { changes: SupplierChange[] } | { errors: FieldErrors } | { unchanged: true };

const removed = (form: FormData, item: Contact) => formText(form, removeField(item.id)) === '1';

/** A deletion is a contact change with an empty value (migration 20261123000000). */
function removals(form: FormData, supplierId: string, current: readonly Contact[]) {
  return current
    .filter((item) => removed(form, item))
    .map((item): SupplierChange => ({
      supplier_id: supplierId,
      kind: 'contact',
      contact_kind: item.kind,
      contact_id: item.id,
      value: '',
    }));
}

/** Which inputs the contacts in the request came from, so an error lands on its field. */
function contactRows(form: FormData, current: readonly Contact[]) {
  const rows = current
    .filter((item) => !removed(form, item))
    .map((item) => ({
      field: contactField(item.id),
      contact: {
        contact_id: item.id,
        kind: item.kind,
        value: formText(form, contactField(item.id)),
      },
      before: item.value,
    }));
  const value = formText(form, NEW_VALUE);
  const kind = formText(form, NEW_KIND);
  if (value || kind) {
    rows.push({ field: NEW_VALUE, contact: { contact_id: '', kind, value }, before: '' });
  }
  return rows;
}

type Row = ReturnType<typeof contactRows>[number];
/** Moves an error from its request path (`contacts.1.value`) to the input it came from. */
function fieldErrors(errors: FieldErrors, rows: Row[]): FieldErrors {
  const result: FieldErrors = {};
  for (const [path, message] of Object.entries(errors)) {
    const index = /^contacts\.(\d+)\./.exec(path)?.[1];
    const row = index === undefined ? undefined : rows[Number(index)];
    const field = row ? (path.endsWith('.kind') ? NEW_KIND : row.field) : path;
    result[field] ??= message;
  }
  return result;
}

/** The changed contacts as change requests; a new contact has no contact_id. */
function contactChanges(supplierId: string, contacts: Row['contact'][], rows: Row[]) {
  return contacts
    .filter((contact, index) => contact.value !== rows[index]?.before)
    .map((contact): SupplierChange => ({
      supplier_id: supplierId,
      kind: 'contact',
      contact_kind: contact.kind,
      value: contact.value,
      ...(contact.contact_id ? { contact_id: contact.contact_id } : {}),
    }));
}

/**
 * Checks the whole dialog with the shared rules and lists only what changed: the name, the
 * kind and each contact whose value differs. Nothing changed means no request at all.
 */
export function parseEditForm(form: FormData, data: SupplierDetail): EditResult {
  const current = data.contacts.filter((item) => item.status === 'current');
  const rows = contactRows(form, current);
  const checked = check(supplierEditForm, {
    display_name: formText(form, NAME),
    contacts: rows.map((row) => row.contact),
  });
  const kind = formText(form, KIND) || data.supplier.entity_kind;
  if (!checked.ok) return { errors: fieldErrors(checked.errors, rows) };
  if (!Object.hasOwn(ENTITY_KINDS, kind)) return { errors: { [KIND]: RULE_MESSAGES.bad_choice } };
  const id = data.supplier.id;
  const changes: SupplierChange[] = [];
  if (checked.value.display_name !== data.supplier.display_name) {
    changes.push({ supplier_id: id, kind: 'rename', value: checked.value.display_name });
  }
  if (kind !== data.supplier.entity_kind) {
    changes.push({ supplier_id: id, kind: 'entity_kind', value: kind });
  }
  changes.push(...contactChanges(id, checked.value.contacts, rows));
  changes.push(...removals(form, id, current));
  return changes.length === 0 ? { unchanged: true } : { changes };
}

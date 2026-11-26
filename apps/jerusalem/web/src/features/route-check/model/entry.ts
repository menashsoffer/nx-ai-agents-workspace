// What the request details form holds between steps, and the request it edits once saved.
import type { RequestDetails, SavedRequest } from '../api/saved.ts';
import type { DraftFields } from './draft.ts';

/** What was typed, as typed, so a return to the details step shows it again. */
export interface Values {
  subject: string;
  estimated_value: string;
  vat: boolean;
  requested_exemption: string;
  unit_id: string;
}
/** The saved request the form edits, and a key of its details as last stored. */
export interface SavedEntry {
  id: string;
  key: string;
}
export interface Entry {
  values: Values;
  saved: SavedEntry | null;
}
export const EMPTY_ENTRY: Entry = {
  values: { subject: '', estimated_value: '', vat: false, requested_exemption: '', unit_id: '' },
  saved: null,
};

/** One key for equal details, so an unchanged form writes nothing. */
function keyOf(details: RequestDetails): string {
  const { subject, estimated_value, value_includes_vat, requested_exemption } = details;
  return JSON.stringify([subject, estimated_value, value_includes_vat, requested_exemption]);
}

export function detailsOf({ draft, subject }: DraftFields) {
  const details: RequestDetails = { subject, ...draft };
  return { details, key: keyOf(details) };
}

/** A saved request opened from the saved list, with the form filled from it. */
export function savedEntry(request: SavedRequest): Entry {
  return {
    values: {
      subject: request.subject,
      estimated_value: String(request.estimated_value),
      vat: request.value_includes_vat,
      requested_exemption: request.requested_exemption ?? '',
      unit_id: request.unit_id,
    },
    saved: { id: request.id, key: keyOf(request) },
  };
}

function raw(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

/** A saved request keeps its unit; the database does not move it. */
export function valuesOf(form: FormData, entry: Entry): Values {
  return {
    subject: raw(form, 'subject'),
    estimated_value: raw(form, 'estimated_value'),
    vat: form.get('value_includes_vat') === 'on',
    requested_exemption: raw(form, 'requested_exemption'),
    unit_id: entry.saved ? entry.values.unit_id : raw(form, 'unit_id'),
  };
}

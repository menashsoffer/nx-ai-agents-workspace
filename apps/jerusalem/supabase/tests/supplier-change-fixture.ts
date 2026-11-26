// Suppliers for the supplier change tests (supplier-edit-checks-spec-he.md). SUPPLIER from
// the access fixture holds a pending company number and no registrar name.
import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER } from './access-fixture.ts';

export const VERIFIED = '41000000-0000-0000-0000-000000000001';
export const TRADER = '41000000-0000-0000-0000-000000000002';
export const NEIGHBOUR = '41000000-0000-0000-0000-000000000003';
export const RETIRED = '41000000-0000-0000-0000-000000000004';
export const BARE = '41000000-0000-0000-0000-000000000005';
export const PHONE = '51000000-0000-0000-0000-000000000001';

export const CHANGE_FIXTURE = `
  insert into public.suppliers (id, display_name, entity_kind, status, status_reason,
    status_source, status_changed_on) values
    ('${VERIFIED}', 'הנדסה ירושלמית', 'company', 'active', null, null, null),
    ('${TRADER}', 'דנה כהן ייעוץ', 'sole_trader', 'active', null, null, null),
    ('${NEIGHBOUR}', 'אורבן תכנון ובינוי', 'unknown', 'active', null, null, null),
    ('${RETIRED}', 'ספק ותיק', 'unknown', 'inactive', 'נסגר', 'מכתב', '2026-01-01'),
    ('${BARE}', 'מרכז הסעות בע"מ', 'unknown', 'active', null, null, null);
  insert into public.supplier_identifiers (supplier_id, scheme, value, registrar_name,
    review_status) values
    ('${VERIFIED}', 'company', '513000001', 'חברת הנדסה ירושלמית בע"מ', 'verified');
  insert into public.supplier_contacts (id, supplier_id, kind, value) values
    ('${PHONE}', '${SUPPLIER}', 'phone', '02-6291111'),
    (gen_random_uuid(), '${NEIGHBOUR}', 'email', 'office@urban.example');
`;

export interface ChangeInput {
  supplier_id: string;
  kind: 'rename' | 'entity_kind' | 'contact';
  value: string;
  contact_kind?: string;
  contact_id?: string;
  reason?: string;
}

export interface CheckResult {
  outcome: string;
  checks: { check: string; outcome: string; problem?: string; name?: string }[];
}

export interface Submitted extends CheckResult {
  request_id: string;
  status: string;
}

export async function checkChange(db: PGlite, change: ChangeInput): Promise<CheckResult> {
  const { rows } = await db.query<{ value: CheckResult }>(
    'select public.check_supplier_change($1::jsonb) as value',
    [JSON.stringify(change)],
  );
  if (!rows[0]) throw new Error('No answer');
  return rows[0].value;
}

export async function submitChange(db: PGlite, change: ChangeInput): Promise<Submitted> {
  const { rows } = await db.query<{ value: Submitted }>(
    'select public.submit_supplier_change($1::jsonb) as value',
    [JSON.stringify(change)],
  );
  if (!rows[0]) throw new Error('No answer');
  return rows[0].value;
}

export async function decideChange(
  db: PGlite,
  id: string,
  decision: { approve: boolean; note?: string },
): Promise<void> {
  await db.query('select public.decide_supplier_change($1::uuid, $2, $3)', [
    id,
    decision.approve,
    decision.note ?? null,
  ]);
}

export async function failure(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    return 'no error';
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return `${code ?? ''} ${message ?? ''}`;
  }
}

export function outcomeOf(result: CheckResult, check: string): string | undefined {
  return result.checks.find((item) => item.check === check)?.outcome;
}

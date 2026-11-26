// Supplier-side people on top of the access fixture: an owner linked to SUPPLIER, a person
// whose link still waits, and the owner of a second supplier.
import { ACCESS_FIXTURE, SUPPLIER, UNIT_1 } from './access-fixture.ts';

export const OTHER_SUPPLIER = '40000000-0000-0000-0000-000000000002';
export const REQUEST = '50000000-0000-0000-0000-000000000001';

export const PEOPLE = {
  owner: '10000000-0000-0000-0000-0000000000a1',
  waiting: '10000000-0000-0000-0000-0000000000a2',
  otherOwner: '10000000-0000-0000-0000-0000000000a3',
} as const;

export const SUPPLIER_ACCOUNT_FIXTURE = `
  ${ACCESS_FIXTURE}
  insert into auth.users (id) values
    ('${PEOPLE.owner}'), ('${PEOPLE.waiting}'), ('${PEOPLE.otherOwner}');
  insert into public.suppliers (id, display_name) values ('${OTHER_SUPPLIER}', 'ספק אחר');
  insert into public.supplier_contacts (supplier_id, kind, value) values
    ('${SUPPLIER}', 'email', 'office@example.co.il');
  insert into public.engagement_requests
    (id, unit_id, subject, subject_key, estimated_value, value_includes_vat)
    values ('${REQUEST}', '${UNIT_1}', 'ייעוץ', 'consulting', 50000, true);
  insert into public.supplier_accounts (user_id, supplier_id, role, status, method, decided_at)
    values ('${PEOPLE.owner}', '${SUPPLIER}', 'owner', 'active', 'email_match', now()),
      ('${PEOPLE.otherOwner}', '${OTHER_SUPPLIER}', 'owner', 'active', 'invite', now());
  insert into public.supplier_accounts (user_id, supplier_id, role, method, proof_path)
    values ('${PEOPLE.waiting}', '${SUPPLIER}', 'owner', 'document', 'link-proofs/a.pdf');
  insert into public.portal_people (user_id, first_name, last_name) values
    ('${PEOPLE.owner}', 'דנה', 'כהן'), ('${PEOPLE.otherOwner}', 'רון', 'לוי');
`;

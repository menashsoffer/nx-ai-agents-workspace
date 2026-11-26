// A supplier account must get nothing from the staff side (supplier-portal spec, 7.5).
// Every table and every function a signed-in user can reach is listed here. A new one fails
// this test until it is classified, so no staff function reaches suppliers by accident.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, UNIT_1, USERS, VERSION } from './access-fixture.ts';
import { PEOPLE, REQUEST, SUPPLIER_ACCOUNT_FIXTURE } from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

type Json = Record<string, unknown>;
type Expect = 'reject' | ((value: unknown) => void);

const NO_ACCESS = { admin: false, editor: false, member: false, manager: false };

function json(value: Json): string {
  return `'${JSON.stringify(value)}'::jsonb`;
}

// Relations a supplier may read, and what they may hold for the fixture's owner.
const READABLE: Record<string, (rows: Json[]) => void> = {
  org_units: () => undefined, // unit names, shown on the municipality's site too
  supplier_accounts: (rows) => {
    assert.equal(rows.length, 1);
  },
  portal_people: (rows) => {
    assert.equal(rows.length, 1);
  },
  threshold_coverage: (rows) => {
    assert.equal(rows[0]?.covered_until, null);
  },
};

const REJECT = new Set([
  'home_overview()',
  'registry_reviews()',
  'registry_review(uuid)',
  'set_registry_validity(uuid,date)',
  'decide_membership(uuid,boolean,text)',
  'award_engagement_request(uuid,uuid,text)',
  'supplier_link_queue()',
  'supplier_area_accounts(uuid)',
  'supplier_document_queue()',
  'decide_supplier_document(uuid,boolean,text,text)',
  'revoke_supplier_account(uuid,text)',
  'portal_request_link(jsonb)',
  'portal_find_supplier(text,text)',
  'portal_accept_invite(uuid)',
  'invite_supplier_account(uuid,text)',
  'decide_supplier_account(uuid,boolean,text)',
  'addresses_to_check()',
  'cancel_access_change(uuid)',
  'cancel_supplier_change(uuid)',
  'check_supplier_change(jsonb)',
  'decide_access_change(uuid,boolean,text)',
  'decide_category_request(uuid,text,text,uuid)',
  'decide_identifier_candidate(uuid,boolean)',
  'decide_supplier_change(uuid,boolean,text)',
  'decide_threshold_proposal(uuid,boolean,text)',
  'error_cases(integer)',
  'error_summary()',
  'grant_role(uuid,text,uuid)',
  'identifier_lookup_input(uuid)',
  'import_identifier_candidates(jsonb)',
  'import_pool_contacts(jsonb)',
  'import_pool_registry(jsonb)',
  'import_venue_specs(jsonb)',
  'apply_import_batch(uuid)',
  'decide_import_rows(jsonb)',
  'stage_excel_import(jsonb)',
  'last_approaches(uuid[])',
  'load_control()',
  'merge_suppliers(uuid,uuid)',
  'record_threshold(numeric,date,text)',
  'record_web_telemetry(jsonb)',
  'request_access_change(text,text,text,uuid,uuid,jsonb)',
  'revoke_role(uuid)',
  'registry_check_input(uuid)',
  'suggest_supplier_kinds()',
  'decide_kind_suggestion(uuid,boolean)',
  'route_check_preview_input(jsonb,date)',
  'set_supplier_status(uuid,jsonb)',
  'submit_supplier_change(jsonb)',
  // A linked supplier may propose or record a file; null input fails on its shape first.
  'portal_propose_change(jsonb)',
  'portal_save_document(jsonb)',
  // An owner manages the supplier's people; null input finds no supplier, invite or link.
  'portal_invite_member(jsonb)',
  'portal_cancel_invite(uuid)',
  'portal_remove_member(uuid)',
  // Approaches: null input finds no approach; staff functions refuse a supplier.
  'portal_answer_approach(jsonb)',
  'portal_withdraw_answer(uuid)',
  'record_supplier_approaches(uuid,uuid[],text,text)',
  'request_approaches(uuid)',
  'record_approach_answer(jsonb)',
  'extend_approach_deadline(uuid,text,text)',
]);

// Calls that need real arguments: with nulls they would fail on input before the access check.
const CALLS: Record<string, [string, Expect]> = {
  'admin_overview()': [
    '',
    (v) => {
      assert.deepEqual(v, {});
    },
  ],
  'approve_profile(uuid,text,uuid,text)': [
    `'${PEOPLE.owner}', 'viewer', '${UNIT_1}', null`,
    'reject',
  ],
  'calculate_thresholds(numeric)': ['100', () => undefined], // arithmetic on public amounts
  'cancel_engagement_request(uuid,text)': [`'${REQUEST}', 'סיבה לביטול'`, 'reject'],
  'catalog_snapshot(text)': [
    'null',
    (v) => {
      assert.deepEqual(Object.keys(v as Json).sort(), ['access', 'user_id', 'version']);
    },
  ],
  'create_engagement_request(jsonb)': [
    json({ unit_id: UNIT_1, subject: 'בדיקה', estimated_value: 1, value_includes_vat: true }),
    'reject',
  ],
  'decide_profile(uuid,text,text)': [`'${PEOPLE.owner}', 'active', null`, 'reject'],
  // The supplier side: the caller's own links and own supplier only.
  'portal_me()': [
    '',
    (v) => {
      assert.equal(((v as Json).accounts as Json[]).length, 1);
    },
  ],
  'portal_changes(uuid)': [
    `'${SUPPLIER}'`,
    (v) => {
      assert.deepEqual(v, []);
    },
  ],
  'portal_documents(uuid)': [
    `'${SUPPLIER}'`,
    (v) => {
      assert.deepEqual((v as Json).documents, []);
    },
  ],
  'portal_members(uuid)': [
    `'${SUPPLIER}'`,
    (v) => {
      assert.equal(((v as Json).members as Json[]).length, 1);
    },
  ],
  'portal_supplier(uuid)': [
    `'${SUPPLIER}'`,
    (v) => {
      assert.equal((v as Json).name, 'ספק');
    },
  ],
  'portal_approaches(uuid)': [
    `'${SUPPLIER}'`,
    (v) => {
      assert.deepEqual(v, []);
    },
  ],
  'my_access()': [
    '',
    (v) => {
      assert.deepEqual(v, NO_ACCESS);
    },
  ],
  'record_supplier_approaches(uuid,uuid[],text)': [
    `'${REQUEST}', array['${SUPPLIER}']::uuid[],
    'email'`,
    'reject',
  ],
  // Suppliers report usage like staff; the server stores their role only.
  'record_usage_events(jsonb)': [
    `'[{"visit_id":"70000000-0000-0000-0000-000000000001","kind":"visit_start",` +
      `"screen":"supplier-area","device":"mobile"}]'::jsonb`,
    () => undefined,
  ],
  'usage_summary(date,date,text)': [`current_date, current_date, null`, 'reject'],
  'rename_supplier(jsonb)': [json({ supplier_id: SUPPLIER, display_name: 'שם אחר' }), 'reject'],
  'replace_supplier_contact(jsonb)': [
    json({ supplier_id: SUPPLIER, kind: 'phone', value: '0527654321' }),
    'reject',
  ],
  'route_check_input(uuid,date)': [`'${REQUEST}', null`, 'reject'],
  'save_supplier_membership(jsonb)': [
    json({ supplier_id: SUPPLIER, registry_version_id: VERSION }),
    'reject',
  ],
  'supplier_detail(uuid)': [
    `'${SUPPLIER}'`,
    (v) => {
      assert.deepEqual(v, { audit: null, contacts: [], identifiers: [] });
    },
  ],
  'update_engagement_request(uuid,jsonb)': [
    `'${REQUEST}', ${json({ subject: 'שינוי' })}`,
    'reject',
  ],
};

const RELATIONS = `select c.relname as name from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
  order by 1`;

const FUNCTIONS = `select replace(p.oid::regprocedure::text, 'public.', '') as signature,
    p.proname as name,
    (select string_agg(format('null::%s', format_type(t, null)), ', ')
      from unnest(p.proargtypes::oid[]) t) as nulls
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'execute')
  order by 1`;

describe('a supplier account and the staff side', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('reads no staff table or view', async () => {
    const { rows } = await db.query<{ name: string }>(RELATIONS);
    await as(db, PEOPLE.owner, async () => {
      for (const { name } of rows) {
        const read = await db.query<Json>(`select * from public.${name}`).then(
          (r) => r.rows,
          () => [],
        );
        const check = READABLE[name];
        if (check) check(read);
        else assert.equal(read.length, 0, `${name} returned rows to a supplier`);
      }
    });
  });

  it('classifies every function a signed-in user can call', async () => {
    const { rows } = await db.query<{ signature: string }>(FUNCTIONS);
    const known = new Set([...REJECT, ...Object.keys(CALLS)]);
    const unknown = rows.map((r) => r.signature).filter((s) => !known.has(s));
    assert.deepEqual(unknown, [], 'add each new function to this test');
  });

  it('gets a refusal or nothing from every staff function', async () => {
    const { rows } = await db.query<{ signature: string; name: string; nulls: string | null }>(
      FUNCTIONS,
    );
    await as(db, PEOPLE.owner, async () => {
      for (const { signature, name, nulls } of rows) {
        const [args, expect] = CALLS[signature] ?? [nulls ?? '', 'reject'];
        const call = db.query<{ v: unknown }>(`select public.${name}(${args}) as v`);
        if (expect === 'reject') await assert.rejects(call, Error, signature);
        else expect((await call).rows[0]?.v);
      }
    });
  });

  it('still lets staff use what the supplier is refused', async () => {
    await as(db, USERS.admin, async () => {
      const { rows } = await db.query<{ v: Json }>('select public.my_access() as v');
      assert.equal(rows[0]?.v.admin, true);
    });
  });
});

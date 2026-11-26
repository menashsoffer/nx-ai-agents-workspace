import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, REGISTRY, SUPPLIER, UNIT_2, USERS, VERSION } from './access-fixture.ts';
import { as, asOwnerFor, count, migratedDatabase } from './pglite.ts';

const FIELD = '60000000-0000-0000-0000-000000000001';
const OTHER_VERSION = '60000000-0000-0000-0000-000000000002';
const OTHER_FIELD = '60000000-0000-0000-0000-000000000003';
const UNOWNED_VERSION = '60000000-0000-0000-0000-000000000004';
const UNOWNED_FIELD = '60000000-0000-0000-0000-000000000005';

function payload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    display_name: 'ספק חדש',
    registry_version_id: VERSION,
    registry_field_id: FIELD,
    ...extra,
  });
}
async function save(db: PGlite, value: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    'select public.save_supplier_membership($1::jsonb) as id',
    [value],
  );
  return result.rows[0]?.id ?? '';
}

describe('supplier and membership creation', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.registry_fields (id, registry_id, source_text)
      values ('${FIELD}', '${REGISTRY}', 'תכנון');
      insert into public.registries (id, name, owner_unit_id) values
        ('60000000-0000-0000-0000-000000000010', 'מאגר אחר', '${UNIT_2}'),
        ('60000000-0000-0000-0000-000000000011', 'מאגר ללא יחידה', null);
      insert into public.registry_versions (id, registry_id) values
        ('${OTHER_VERSION}', '60000000-0000-0000-0000-000000000010'),
        ('${UNOWNED_VERSION}', '60000000-0000-0000-0000-000000000011');
      insert into public.registry_fields (id, registry_id, source_text) values
        ('${OTHER_FIELD}', '60000000-0000-0000-0000-000000000010', 'תחום אחר'),
        ('${UNOWNED_FIELD}', '60000000-0000-0000-0000-000000000011', 'תחום ללא יחידה')`);
  });
  after(async () => {
    await db.close();
  });

  it('creates an unverified supplier, membership and contacts together', async () => {
    await as(db, USERS.editor, async () => {
      const id = await save(
        db,
        payload({ phone: '0521234567', engagement_started_on: '2026-01-02' }),
      );
      const rows = await db.query<{ review_status: string; created_by: string }>(
        'select review_status, created_by from public.suppliers where id=$1::uuid',
        [id],
      );
      assert.equal(rows.rows[0]?.review_status, 'needs_review');
      assert.equal(rows.rows[0].created_by, USERS.editor);
      assert.equal(
        await count(db, `select 1 from public.memberships where supplier_id='${id}'`),
        1,
      );
      await assert.rejects(
        db.query("update public.suppliers set review_status='verified' where id=$1::uuid", [id]),
      );
    });
  });

  it('rejects viewers, other units and unowned pools without leaving a supplier behind', async () => {
    const beforeCount = await count(db, 'select 1 from public.suppliers');
    await as(db, USERS.viewer, async () => {
      await assert.rejects(save(db, payload()));
    });
    await as(db, USERS.editor, async () => {
      await assert.rejects(
        save(db, payload({ registry_version_id: OTHER_VERSION, registry_field_id: OTHER_FIELD })),
      );
      await assert.rejects(
        save(
          db,
          payload({ registry_version_id: UNOWNED_VERSION, registry_field_id: UNOWNED_FIELD }),
        ),
      );
      await assert.rejects(
        db.query(
          `insert into public.memberships (supplier_id, registry_version_id, registry_field_id)
        values ($1::uuid, $2::uuid, $3::uuid)`,
          [SUPPLIER, UNOWNED_VERSION, UNOWNED_FIELD],
        ),
      );
    });
    assert.equal(await count(db, 'select 1 from public.suppliers'), beforeCount);
  });

  it('rejects mismatched fields and identifiers belonging to another supplier', async () => {
    const beforeCount = await count(db, 'select 1 from public.suppliers');
    await as(db, USERS.editor, async () => {
      await assert.rejects(save(db, payload({ registry_field_id: OTHER_FIELD })));
      await assert.rejects(
        db.query(
          `insert into public.memberships
        (supplier_id, registry_version_id, registry_field_id) values ($1::uuid, $2::uuid, $3::uuid)`,
          [SUPPLIER, VERSION, OTHER_FIELD],
        ),
      );
      await assert.rejects(
        save(db, payload({ identifier: '512345678', identifier_scheme: 'company' })),
      );
    });
    assert.equal(await count(db, 'select 1 from public.suppliers'), beforeCount);
  });

  it('lets an admin add a membership to an existing supplier in an unowned pool', async () => {
    await as(db, USERS.admin, async () => {
      const id = await save(
        db,
        payload({
          supplier_id: SUPPLIER,
          registry_version_id: UNOWNED_VERSION,
          registry_field_id: UNOWNED_FIELD,
          display_name: '',
        }),
      );
      assert.equal(id, SUPPLIER);
    });
  });

  it('no longer has the legacy suppliers table or the backup schema', async () => {
    assert.equal(
      await count(db, "select 1 where to_regclass('public.legacy_suppliers') is not null"),
      0,
    );
    assert.equal(await count(db, "select 1 from pg_namespace where nspname = 'backup'"), 0);
  });

  it('preserves an old name and marks the edited supplier for review', async () => {
    await asOwnerFor(db, USERS.editor, async () => {
      await db.query('select public.rename_supplier($1::jsonb)', [
        JSON.stringify({
          supplier_id: SUPPLIER,
          display_name: 'שם מתוקן',
        }),
      ]);
      const result = await db.query<{ display_name: string; review_status: string }>(
        'select display_name, review_status from public.suppliers where id=$1::uuid',
        [SUPPLIER],
      );
      assert.equal(result.rows[0]?.display_name, 'שם מתוקן');
      assert.equal(result.rows[0].review_status, 'needs_review');
      assert.equal(
        await count(
          db,
          `select 1 from public.supplier_names where supplier_id='${SUPPLIER}'
        and name='ספק' and kind='former_name'`,
        ),
        1,
      );
    });
    await asOwnerFor(db, USERS.viewer, async () => {
      await assert.rejects(
        db.query('select public.rename_supplier($1::jsonb)', [
          JSON.stringify({
            supplier_id: SUPPLIER,
            display_name: 'שינוי אסור',
          }),
        ]),
      );
    });
  });

  it('replaces a contact atomically and retains the old value as outdated', async () => {
    await asOwnerFor(db, USERS.editor, async () => {
      const original = await db.query<{ id: string }>(
        `insert into public.supplier_contacts
        (supplier_id, kind, value, is_primary) values ($1::uuid, 'phone', '0521234567', true) returning id`,
        [SUPPLIER],
      );
      const oldId = original.rows[0]?.id;
      await db.query('select public.replace_supplier_contact($1::jsonb)', [
        JSON.stringify({
          supplier_id: SUPPLIER,
          contact_id: oldId,
          kind: 'phone',
          value: '0527654321',
        }),
      ]);
      const rows = await db.query<{ value: string; status: string; is_primary: boolean }>(
        'select value, status, is_primary from public.supplier_contacts where supplier_id=$1::uuid order by value',
        [SUPPLIER],
      );
      assert.deepEqual(
        rows.rows.map((row) => row.status),
        ['outdated', 'current'],
      );
      assert.deepEqual(
        rows.rows.map((row) => row.is_primary),
        [false, true],
      );
    });
  });
});

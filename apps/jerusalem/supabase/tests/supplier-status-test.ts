import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, UNIT_1, USERS, VERSION } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

const REQUEST = '80000000-0000-0000-0000-000000000001';
const DEACTIVATE = JSON.stringify({
  active: false,
  reason: 'מונתה לשופטת',
  source: 'הודעת הנהלת בתי המשפט',
  changedOn: '2026-09-01',
});

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function setStatus(db: PGlite, user: string, change: string) {
  return as(db, user, () =>
    db.query('select public.set_supplier_status($1, $2::jsonb)', [SUPPLIER, change]),
  );
}

async function catalogRow(db: PGlite, user: string): Promise<unknown[] | undefined> {
  return as(db, user, async () => {
    const result = await db.query<{ value: { catalog: { suppliers: unknown[][] } } }>(
      'select public.catalog_snapshot() as value',
    );
    return result.rows[0]?.value.catalog.suppliers.find((row) => row[0] === SUPPLIER);
  });
}

describe('supplier status', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.memberships (supplier_id, registry_version_id, review_status)
        values ('${SUPPLIER}', '${VERSION}', 'verified');
      insert into public.engagement_requests
        (id, unit_id, subject, estimated_value, value_includes_vat)
        values ('${REQUEST}', '${UNIT_1}', 'ייעוץ', 10000, false)`);
  });
  after(async () => {
    await db.close();
  });

  it('lets only an admin change the status', async () => {
    for (const user of [USERS.editor, USERS.manager, USERS.viewer, USERS.auditor]) {
      assert.equal(await errorCode(setStatus(db, user, DEACTIVATE)), '42501');
    }
    const editorWrite = as(db, USERS.editor, () =>
      db.query(`update public.suppliers set status = 'inactive' where id = '${SUPPLIER}'`),
    );
    assert.equal(await errorCode(editorWrite), '42501');
  });

  it('requires a reason and a date to deactivate', async () => {
    // The content rules (validation_rules migration) refuse first, before the table check.
    const noReason = JSON.stringify({ active: false, changedOn: '2026-09-01' });
    assert.equal(await errorCode(setStatus(db, USERS.admin, noReason)), '22023');
    const noDate = JSON.stringify({ active: false, reason: 'סיבה' });
    assert.equal(await errorCode(setStatus(db, USERS.admin, noDate)), '22023');
    assert.equal(await errorCode(setStatus(db, USERS.admin, '{"active": "no"}')), '22023');
  });

  it('shows the reason in the catalog and blocks new engagements and approaches', async () => {
    await setStatus(db, USERS.admin, DEACTIVATE);
    const row = await catalogRow(db, USERS.viewer);
    assert.ok(row);
    assert.equal(row[3], 'inactive');
    assert.deepEqual(row[11], ['מונתה לשופטת', 'הודעת הנהלת בתי המשפט', '2026-09-01']);
    const approach = as(db, USERS.editor, () =>
      db.query(`insert into public.supplier_approaches
        (request_id, supplier_id, approached_on, channel)
        values ('${REQUEST}', '${SUPPLIER}', '2026-11-17', 'email')`),
    );
    assert.equal(await errorCode(approach), '23514');
    const request = db.query(`update public.engagement_requests
      set supplier_id = '${SUPPLIER}' where id = '${REQUEST}'`);
    assert.equal(await errorCode(request), '23514');
  });

  it('clears the reason when the supplier is active again', async () => {
    await setStatus(db, USERS.admin, '{"active": true}');
    const row = await catalogRow(db, USERS.viewer);
    assert.ok(row);
    assert.equal(row[3], null);
    assert.equal(row[11], null);
    await db.query(`insert into public.supplier_approaches
      (request_id, supplier_id, approached_on, channel)
      values ('${REQUEST}', '${SUPPLIER}', '2026-11-17', 'email')`);
  });

  it('reports the identifier state each role is allowed to see', async () => {
    assert.equal((await catalogRow(db, USERS.viewer))?.[10], 'pending');
    await db.exec(`update public.supplier_identifiers set review_status = 'verified'
      where supplier_id = '${SUPPLIER}' and scheme = 'company'`);
    assert.equal((await catalogRow(db, USERS.viewer))?.[10], 'verified');
    await db.exec(`update public.supplier_identifiers set review_status = 'rejected'
      where supplier_id = '${SUPPLIER}'`);
    assert.equal((await catalogRow(db, USERS.viewer))?.[10], null);
    await db.exec(`insert into public.identifier_candidates
      (supplier_id, scheme, value, source, searched_name)
      values ('${SUPPLIER}', 'company', '512345679', 'companies_registrar', 'ספק')`);
    // Candidates are visible to administrators only (18.11.2026), so others still see none.
    assert.equal((await catalogRow(db, USERS.viewer))?.[10], null);
    assert.equal((await catalogRow(db, USERS.editor))?.[10], null);
    assert.equal((await catalogRow(db, USERS.admin))?.[10], 'pending');
  });
});

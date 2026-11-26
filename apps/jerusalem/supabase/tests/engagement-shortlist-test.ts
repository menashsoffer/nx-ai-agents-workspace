import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, UNIT_1, UNIT_2, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

const OTHER = '40000000-0000-0000-0000-000000000002';
const DRAFT = { estimated_value: 120000, value_includes_vat: false, requested_exemption: null };

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function preview(db: PGlite, user: string, draft: unknown) {
  return as(db, user, async () => {
    const result = await db.query<{ input: { request: { subject_key: null }; related: null } }>(
      'select public.route_check_preview_input($1::jsonb, $2) as input',
      [JSON.stringify(draft), '2026-11-17'],
    );
    return result.rows[0]?.input;
  });
}

function createRequest(db: PGlite, user: string, unit: string) {
  const draft = { ...DRAFT, unit_id: unit, subject: 'ייעוץ ארגוני' };
  return as(db, user, async () => {
    const result = await db.query<{ id: string }>(
      'select public.create_engagement_request($1::jsonb) as id',
      [JSON.stringify(draft)],
    );
    return result.rows[0]?.id ?? '';
  });
}

function approach(db: PGlite, user: string, request: string) {
  return as(db, user, async () => {
    const result = await db.query<{ added: number }>(
      `select public.record_supplier_approaches($1, $2::uuid[], 'email') as added`,
      [request, [SUPPLIER, OTHER]],
    );
    return result.rows[0]?.added;
  });
}

function lastApproaches(db: PGlite, user: string, suppliers: string[]) {
  return as(db, user, async () => {
    const result = await db.query<Record<string, unknown>>(
      'select * from public.last_approaches($1::uuid[]) order by supplier_id',
      [suppliers],
    );
    return result.rows;
  });
}

describe('engagement shortlist', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.suppliers (id, display_name) values ('${OTHER}', 'ספק ב')`);
  });
  after(async () => {
    await db.close();
  });

  it('lets a viewer and an auditor check a draft route without saving it', async () => {
    const before = await count(db, 'select 1 from public.engagement_requests');
    for (const user of [USERS.viewer, USERS.auditor, USERS.editor]) {
      const input = await preview(db, user, DRAFT);
      assert.ok(input);
      assert.equal(input.request.subject_key, null);
      assert.equal(input.related, null);
    }
    assert.equal(await count(db, 'select 1 from public.engagement_requests'), before);
    assert.equal(await count(db, 'select 1 from public.route_checks'), 0);
  });

  it('rejects a malformed draft and users who are not members', async () => {
    const bad = [{ ...DRAFT, estimated_value: '1' }, { ...DRAFT, requested_exemption: '9' }, []];
    for (const draft of bad) {
      assert.equal(await errorCode(preview(db, USERS.viewer, draft)), 'PT400');
    }
    assert.equal(await errorCode(preview(db, USERS.pending, DRAFT)), 'PT403');
    assert.equal(await errorCode(preview(db, USERS.blocked, DRAFT)), 'PT403');
  });

  it('lets only an editor or manager of the unit save the request', async () => {
    for (const user of [USERS.viewer, USERS.auditor]) {
      assert.equal(await errorCode(createRequest(db, user, UNIT_1)), '42501');
    }
    assert.equal(await errorCode(createRequest(db, USERS.editor, UNIT_2)), '42501');
    assert.match(await createRequest(db, USERS.manager, UNIT_1), /^[0-9a-f-]{36}$/);
  });

  it('records each supplier once per request and blocks other units', async () => {
    const request = await createRequest(db, USERS.editor, UNIT_1);
    assert.equal(await approach(db, USERS.editor, request), 2);
    assert.equal(await approach(db, USERS.manager, request), 0);
    assert.equal(await errorCode(approach(db, USERS.viewer, request)), '42501');
    assert.equal(await errorCode(approach(db, USERS.otherViewer, request)), '42501');
  });

  it('shows anyone only the last approach date', async () => {
    const rows = await lastApproaches(db, USERS.otherViewer, [SUPPLIER, OTHER]);
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0] ?? {}).sort(), ['last_on', 'supplier_id']);
    const many = Array.from({ length: 51 }, () => SUPPLIER);
    assert.equal(await errorCode(lastApproaches(db, USERS.viewer, many)), '22023');
    assert.equal(await errorCode(lastApproaches(db, USERS.pending, [SUPPLIER])), '42501');
  });
});

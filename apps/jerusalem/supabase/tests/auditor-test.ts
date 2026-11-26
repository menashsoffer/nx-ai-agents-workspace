import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, UNIT_2, USERS, VERSION } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

describe('auditor role', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.engagement_requests
      (unit_id, subject, subject_key, estimated_value, value_includes_vat)
      values ('${UNIT_2}', 'ייעוץ', 'consulting', 50000, true)`);
  });
  after(async () => {
    await db.close();
  });

  it('holds no unit, unlike every role but admin', async () => {
    await assert.rejects(
      db.exec(`insert into public.role_grants (user_id, role, unit_id)
        values ('${USERS.viewer}', 'auditor', '${UNIT_2}')`),
      /role_grants_check/,
    );
  });

  it('reads shared data, every unit and the admin-only tables', async () => {
    await as(db, USERS.auditor, async () => {
      assert.equal(await count(db, 'select 1 from public.suppliers'), 1);
      assert.equal(await count(db, 'select 1 from public.engagement_requests'), 1);
      assert.ok((await count(db, 'select 1 from public.profiles')) > 1);
      assert.ok((await count(db, 'select 1 from public.role_grants')) > 1);
      assert.ok((await count(db, 'select 1 from public.audit_log')) > 0);
    });
  });

  it('cannot write anything', async () => {
    await as(db, USERS.auditor, async () => {
      await assert.rejects(
        db.exec(`insert into public.suppliers (display_name) values ('ספק חדש')`),
        /row-level security/,
      );
      await assert.rejects(
        db.exec(`insert into public.memberships (supplier_id, registry_version_id)
          values ('${SUPPLIER}', '${VERSION}')`),
        /row-level security/,
      );
      await assert.rejects(
        db.exec(`insert into public.engagement_requests
          (unit_id, subject, subject_key, estimated_value, value_includes_vat)
          values ('${UNIT_2}', 'בדיקה', 'test', 1, true)`),
        /row-level security/,
      );
      await assert.rejects(
        db.query(`select public.grant_role('${USERS.viewer}', 'editor', '${UNIT_2}')`),
        /not authorized/i,
      );
      const updated = await db.query(
        `update public.engagement_requests set subject = 'שונה' returning id`,
      );
      assert.equal(updated.rows.length, 0);
    });
  });

  it('does not let a plain viewer read the audit log', async () => {
    await as(db, USERS.viewer, async () => {
      assert.equal(await count(db, 'select 1 from public.audit_log'), 0);
    });
  });
});

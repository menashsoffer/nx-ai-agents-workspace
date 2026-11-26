import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS, VERSION } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

describe('workflow functions', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('lets only the unit manager or an admin approve a profile', async () => {
    const approve = `select public.decide_profile('${USERS.pending}', 'active')`;
    await as(db, USERS.editor, async () => {
      await assert.rejects(db.query(approve), /not authorized/);
    });
    await as(db, USERS.manager, async () => db.query(approve));
    await as(db, USERS.pending, async () => {
      const access = await db.query<{ a: { member: boolean } }>('select public.my_access() a');
      assert.equal(access.rows[0]?.a.member, true);
    });
  });

  it('requires a reason to reject a profile', async () => {
    const user = '10000000-0000-0000-0000-000000000099';
    await db.exec(`insert into auth.users (id) values ('${user}');
      insert into public.profiles (user_id, first_name, last_name, email, job_title, unit_id,
        purpose) values ('${user}', 'n', 'n', 'n@example.test', 'staff',
        '20000000-0000-0000-0000-000000000001', 'testing access')`);
    await as(db, USERS.admin, async () => {
      const reject = `select public.decide_profile('${user}', 'rejected')`;
      await assert.rejects(db.query(reject), /profiles_check/);
      await db.query(`select public.decide_profile('${user}', 'rejected', 'לא עובד עירייה')`);
    });
  });

  it('never revokes the last admin', async () => {
    const grant = await db.query<{ id: string }>(
      `select id from public.role_grants where role = 'admin'`,
    );
    await as(db, USERS.admin, async () => {
      const revoke = `select public.revoke_role('${grant.rows[0]?.id ?? ''}')`;
      await assert.rejects(db.query(revoke), /reason:last_admin/);
    });
  });

  it('lets a manager grant editor in their unit but not admin', async () => {
    await as(db, USERS.manager, async () => {
      await db.query(`select public.grant_role('${USERS.viewer}', 'editor',
        '20000000-0000-0000-0000-000000000001')`);
      await assert.rejects(
        db.query(`select public.grant_role('${USERS.viewer}', 'admin')`),
        /Not authorized/,
      );
    });
  });

  it('merges suppliers and keeps the old name', async () => {
    const other = await db.query<{ id: string }>(`insert into public.suppliers (display_name)
      values ('ספק בע"מ ישן') returning id`);
    const source = other.rows[0]?.id ?? '';
    await db.exec(`insert into public.memberships (supplier_id, registry_version_id)
      values ('${source}', '${VERSION}')`);
    const merge = `select public.merge_suppliers('${source}', '${SUPPLIER}')`;
    await as(db, USERS.editor, async () => {
      await assert.rejects(db.query(merge), /Only an admin/);
    });
    await as(db, USERS.admin, async () => db.query(merge));
    const moved = `select 1 from public.memberships where supplier_id = '${SUPPLIER}'`;
    assert.equal(await count(db, moved), 1);
    const kept = `select 1 from public.supplier_names where supplier_id = '${SUPPLIER}'`;
    assert.equal(await count(db, kept), 1);
    const merged = `select 1 from public.suppliers where id = '${source}' and status = 'merged'`;
    assert.equal(await count(db, merged), 1);
  });

  it('turns an approved category request into a category', async () => {
    const id = await as(db, USERS.viewer, async () => {
      const row = await db.query<{ id: string }>(`insert into public.category_requests
        (proposed_name, description) values ('ייעוץ אקוסטי', 'תחום חסר במאגרים') returning id`);
      return row.rows[0]?.id ?? '';
    });
    await as(db, USERS.admin, async () => {
      await db.query(`select public.decide_category_request('${id}', 'approved', 'נדרש')`);
    });
    assert.equal(await count(db, "select 1 from public.categories where name = 'ייעוץ אקוסטי'"), 1);
  });
});

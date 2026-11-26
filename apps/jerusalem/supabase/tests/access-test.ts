import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, UNIT_1, USERS, VERSION } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

const MEMBERSHIP = `insert into public.memberships (supplier_id, registry_version_id)
  values ('${SUPPLIER}', '${VERSION}') returning id`;

describe('row level security by role', () => {
  let db: PGlite;
  let membership = '';
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('gives anon no access at all', async () => {
    await as(db, null, async () => {
      await assert.rejects(db.query('select * from public.suppliers'), /permission denied/);
      await assert.rejects(db.query('select * from public.profiles'), /permission denied/);
    });
  });

  it('shows pending and blocked users only their own profile', async () => {
    for (const user of [USERS.pending, USERS.blocked]) {
      await as(db, user, async () => {
        assert.equal(await count(db, 'select 1 from public.suppliers'), 0);
        assert.equal(await count(db, 'select 1 from public.profiles'), 1);
      });
    }
  });

  it('lets an editor propose a membership but not verify it', async () => {
    await as(db, USERS.editor, async () => {
      const inserted = await db.query<{ id: string }>(MEMBERSHIP);
      membership = inserted.rows[0]?.id ?? '';
      const verify = `update public.memberships set review_status = 'verified'
        where id = '${membership}'`;
      await assert.rejects(db.exec(verify), /unit manager/);
    });
  });

  it('hides unverified memberships from viewers', async () => {
    await as(db, USERS.viewer, async () => {
      assert.equal(await count(db, 'select 1 from public.memberships'), 0);
      await assert.rejects(db.query(MEMBERSHIP), /row-level security/);
    });
  });

  it('lets a manager verify someone else’s entry and records who did', async () => {
    await as(db, USERS.manager, async () => {
      await db.exec(`update public.memberships set review_status = 'verified'
        where id = '${membership}'`);
    });
    const row = await db.query<{ by: string }>(
      `select verified_by as by from public.memberships where id = '${membership}'`,
    );
    assert.equal(row.rows[0]?.by, USERS.manager);
    await as(db, USERS.viewer, async () => {
      assert.equal(await count(db, 'select 1 from public.memberships'), 1);
    });
  });

  it('stops a manager from verifying their own entry', async () => {
    await as(db, USERS.manager, async () => {
      const own = await db.query<{ id: string }>(`insert into public.suppliers (display_name)
        values ('ספק חדש') returning id`);
      const verify = `update public.suppliers set review_status = 'verified'
        where id = '${own.rows[0]?.id ?? ''}'`;
      await assert.rejects(db.exec(verify), /reason:self_verification/);
    });
  });

  it('shows a personal ID number to editors only', async () => {
    const ids = 'select 1 from public.supplier_identifiers';
    await as(db, USERS.viewer, async () => {
      assert.equal(await count(db, ids), 1);
    });
    await as(db, USERS.editor, async () => {
      assert.equal(await count(db, ids), 2);
    });
  });

  it('keeps engagement requests inside the unit', async () => {
    const insert = `insert into public.engagement_requests (unit_id, subject, estimated_value,
      value_includes_vat) values ('${UNIT_1}', 'ייעוץ תנועה', 100000, true) returning id`;
    const id = await as(db, USERS.editor, async () => {
      const row = await db.query<{ id: string }>(insert);
      return row.rows[0]?.id ?? '';
    });
    const approve = `update public.engagement_requests set status = 'approved'
      where id = '${id}'`;
    await as(db, USERS.otherViewer, async () => {
      assert.equal(await count(db, 'select 1 from public.engagement_requests'), 0);
    });
    await as(db, USERS.editor, async () => {
      await assert.rejects(db.exec(approve), /row-level security/);
    });
    await as(db, USERS.manager, async () => db.exec(approve));
  });

  it('writes an audit entry with the acting user', async () => {
    const audit = `select 1 from public.audit_log
      where table_name = 'memberships' and actor_id = '${USERS.manager}'`;
    assert.equal(await count(db, audit), 1);
    await as(db, USERS.viewer, async () => {
      assert.equal(await count(db, 'select 1 from public.audit_log'), 0);
    });
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { ACCESS_FIXTURE, USERS, UNIT_1, UNIT_2 } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';
describe('user administration invariants used by R5', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });
  it('does not allow an active administrator to decide their own active profile again', async () => {
    await as(db, USERS.admin, async () => {
      await assert.rejects(
        db.query("select public.decide_profile($1,'active',null)", [USERS.admin]),
        /not found or not authorized/i,
      );
    });
  });
  it('does not let a pending profile with an admin grant approve itself', async () => {
    await db.query("insert into public.role_grants(user_id,role) values($1,'admin')", [
      USERS.pending,
    ]);
    await as(db, USERS.pending, async () => {
      await assert.rejects(
        db.query("select public.decide_profile($1,'active',null)", [USERS.pending]),
        /not found or not authorized/i,
      );
    });
    const profile = await db.query<{ status: string }>(
      'select status from public.profiles where user_id=$1',
      [USERS.pending],
    );
    assert.equal(profile.rows[0]?.status, 'pending');
    await db.query("delete from public.role_grants where user_id=$1 and role='admin'", [
      USERS.pending,
    ]);
  });
  it('refuses unrelated or inactive roles and anon before changing a pending request', async () => {
    for (const actor of [
      null,
      USERS.viewer,
      USERS.editor,
      USERS.auditor,
      USERS.pending,
      USERS.blocked,
      USERS.otherViewer,
    ]) {
      await as(db, actor, async () => {
        await assert.rejects(
          db.query("select public.decide_profile($1,'active',null)", [USERS.pending]),
        );
      });
    }
    const profile = await db.query<{ status: string }>(
      'select status from public.profiles where user_id=$1',
      [USERS.pending],
    );
    assert.equal(profile.rows[0]?.status, 'pending');
  });
  it('needs a reason to reject an access request', async () => {
    await as(db, USERS.manager, async () => {
      await assert.rejects(
        db.query("select public.decide_profile($1,'rejected',null)", [USERS.pending]),
        /profiles_check/,
      );
    });
  });
  it('allows another unit manager to approve and records the reviewer and initial viewer role', async () => {
    await as(db, USERS.manager, async () => {
      await db.query("select public.decide_profile($1,'active',null)", [USERS.pending]);
    });
    const row = await db.query<{ reviewed_by: string; status: string }>(
      'select reviewed_by,status from public.profiles where user_id=$1',
      [USERS.pending],
    );
    assert.equal(row.rows[0]?.reviewed_by, USERS.manager);
    assert.equal(row.rows[0].status, 'active');
    const grant = await db.query<{ role: string; unit_id: string }>(
      'select role,unit_id from public.role_grants where user_id=$1 and revoked_at is null',
      [USERS.pending],
    );
    assert.deepEqual(grant.rows, [{ role: 'viewer', unit_id: UNIT_1 }]);
  });
  it('keeps manager grants scoped and prevents removal of the last administrator', async () => {
    await as(db, USERS.manager, async () => {
      await assert.rejects(
        db.query("select public.grant_role($1,'admin',null)", [USERS.viewer]),
        /not authorized/i,
      );
      await assert.rejects(
        db.query("select public.grant_role($1,'editor',$2)", [USERS.viewer, UNIT_2]),
        /not authorized/i,
      );
    });
    const grant = await db.query<{ id: string }>(
      "select id from public.role_grants where user_id=$1 and role='admin'",
      [USERS.admin],
    );
    await as(db, USERS.admin, async () => {
      await assert.rejects(
        db.query('select public.revoke_role($1)', [grant.rows[0]?.id]),
        /reason:last_admin/,
      );
    });
  });
});

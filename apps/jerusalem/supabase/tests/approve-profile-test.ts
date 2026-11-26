import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { ACCESS_FIXTURE, USERS, UNIT_1, UNIT_2 } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

type Approval = [role: string, unit: string | null];

async function approve(db: PGlite, who: string, [role, unit]: Approval) {
  await as(db, who, async () => {
    await db.query('select public.approve_profile($1, $2, $3)', [USERS.pending, role, unit]);
  });
}

async function state(db: PGlite) {
  const profile = await db.query<{ status: string; reviewed_by: string | null }>(
    'select status, reviewed_by from public.profiles where user_id = $1',
    [USERS.pending],
  );
  const grants = await db.query<{ role: string; unit_id: string | null }>(
    'select role, unit_id from public.role_grants where user_id = $1 and revoked_at is null',
    [USERS.pending],
  );
  return { ...profile.rows[0], grants: grants.rows };
}

/** A fresh database per test, since each one decides the same request. */
async function fresh(t: TestContext): Promise<PGlite> {
  const db = await migratedDatabase();
  await db.exec(ACCESS_FIXTURE);
  t.after(() => db.close());
  return db;
}

describe('approve an access request with its role (decision 4)', () => {
  it('lets a unit manager approve as editor of their unit, in one step', async (t) => {
    const db = await fresh(t);
    await approve(db, USERS.manager, ['editor', null]);
    assert.deepEqual(await state(db), {
      status: 'active',
      reviewed_by: USERS.manager,
      grants: [{ role: 'editor', unit_id: UNIT_1 }],
    });
  });

  it('keeps a unit manager to viewer and editor of units they manage', async (t) => {
    const db = await fresh(t);
    await assert.rejects(approve(db, USERS.manager, ['unit_manager', null]), /not authorized/);
    await assert.rejects(approve(db, USERS.manager, ['viewer', UNIT_2]), /not authorized/);
    await assert.rejects(approve(db, USERS.editor, ['viewer', null]), /not authorized/);
    assert.equal((await state(db)).status, 'pending');
  });

  it('lets an admin give any role, with no unit for admin and auditor', async (t) => {
    const db = await fresh(t);
    await approve(db, USERS.admin, ['auditor', UNIT_1]);
    assert.deepEqual((await state(db)).grants, [{ role: 'auditor', unit_id: null }]);
  });

  it('refuses a self-approval, an unknown role and a decided request', async (t) => {
    const db = await fresh(t);
    await db.query("insert into public.role_grants (user_id, role) values ($1, 'admin')", [
      USERS.pending,
    ]);
    await assert.rejects(approve(db, USERS.pending, ['viewer', null]), /not authorized/);
    await assert.rejects(approve(db, USERS.admin, ['owner', null]), /invalid:bad_choice/);
    await approve(db, USERS.admin, ['viewer', null]);
    await assert.rejects(approve(db, USERS.admin, ['viewer', null]), /not authorized/);
  });
});

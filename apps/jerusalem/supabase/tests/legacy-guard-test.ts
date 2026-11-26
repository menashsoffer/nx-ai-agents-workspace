import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, USERS } from './access-fixture.ts';
import { migratedDatabase } from './pglite.ts';

async function withLegacyClaim(
  db: PGlite,
  user: string,
  action: () => Promise<void>,
): Promise<void> {
  const claims = JSON.stringify({
    sub: user,
    role: 'authenticated',
    app_metadata: { role: 'supplier_admin' },
  });
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec('set role authenticated');
  try {
    await action();
  } finally {
    await db.exec('reset role');
  }
}

describe('legacy table requires a current database admin', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase({ until: '20261112091000_guard_legacy_access.sql' });
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.legacy_suppliers (name, field, registry)
      values ('ספק לדוגמה', 'תכנון', 'מאגר')`);
  });
  after(async () => {
    await db.close();
  });

  it('allows an active administrator with the legacy claim', async () => {
    await withLegacyClaim(db, USERS.admin, async () => {
      const result = await db.query('select * from public.legacy_suppliers');
      assert.equal(result.rows.length, 1);
      await db.query(
        `insert into public.legacy_suppliers (name, field, registry, created_by)
        values ('ספק נוסף', 'תכנון', 'מאגר', $1::uuid)`,
        [USERS.admin],
      );
    });
  });

  it('denies pending, blocked and non-admin users even with the old claim', async () => {
    for (const user of [USERS.pending, USERS.blocked, USERS.viewer, USERS.auditor]) {
      await withLegacyClaim(db, user, async () => {
        const result = await db.query('select * from public.legacy_suppliers');
        assert.equal(result.rows.length, 0);
        const updated = await db.query(`update public.legacy_suppliers set name = 'אסור'
          returning id`);
        assert.equal(updated.rows.length, 0);
        await assert.rejects(
          db.query(
            `insert into public.legacy_suppliers
          (name, field, registry, created_by) values ('אסור', 'תכנון', 'מאגר', $1::uuid)`,
            [user],
          ),
        );
      });
    }
  });

  it('denies a formerly privileged admin once the database role is revoked', async () => {
    await db.query(`update public.role_grants set revoked_at = now() where user_id = $1::uuid`, [
      USERS.admin,
    ]);
    await withLegacyClaim(db, USERS.admin, async () => {
      const result = await db.query('select * from public.legacy_suppliers');
      assert.equal(result.rows.length, 0);
    });
  });
});

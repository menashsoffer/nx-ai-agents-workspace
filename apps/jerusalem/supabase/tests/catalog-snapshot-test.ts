import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, UNIT_2, USERS } from './access-fixture.ts';
import { applyMigrations, as, migratedDatabase } from './pglite.ts';
import { BEFORE_SNAPSHOT, directCatalog, snapshotFixture } from './snapshot-fixture.ts';

interface Snapshot {
  user_id: string;
  version: string;
  access: { state: string; member: boolean; grants: unknown[] };
  unchanged?: boolean;
  catalog?: unknown;
}

async function snapshot(db: PGlite, known: string | null = null): Promise<Snapshot> {
  const result = await db.query<{ value: Snapshot }>(
    'select public.catalog_snapshot($1) as value',
    [known],
  );
  assert.ok(result.rows[0]);
  return result.rows[0].value;
}

async function membershipIds(db: PGlite): Promise<string[]> {
  return (await db.query<{ id: string }>('select id from public.memberships order by id')).rows.map(
    (row) => row.id,
  );
}

describe('catalog RPCs preserve RLS and invalidate cached snapshots', () => {
  let db: PGlite;
  const previous = new Map<string, string[]>();
  before(async () => {
    db = await migratedDatabase({ until: BEFORE_SNAPSHOT });
    await snapshotFixture(db);
    for (const user of Object.values(USERS)) {
      previous.set(user, await as(db, user, () => membershipIds(db)));
    }
    await applyMigrations(db, { after: BEFORE_SNAPSHOT });
  });
  after(async () => {
    await db.close();
  });

  for (const [role, user] of Object.entries(USERS)) {
    it(`matches direct reads and the original membership policy for ${role}`, async () => {
      await as(db, user, async () => {
        assert.deepEqual(await membershipIds(db), previous.get(user));
        const result = await snapshot(db);
        assert.equal(result.user_id, user);
        const flags = (await db.query<{ value: object }>('select public.my_access() as value'))
          .rows[0]?.value;
        for (const [key, value] of Object.entries(flags ?? {})) {
          assert.equal((result.access as unknown as Record<string, unknown>)[key], value);
        }
        const direct = await directCatalog(db);
        if (['pending', 'blocked'].includes(role)) {
          assert.equal(result.catalog, undefined);
          assert.equal(result.access.state, role);
        } else {
          assert.deepEqual(result.catalog, direct);
          const cached = await snapshot(db, result.version);
          assert.equal(cached.unchanged, true);
          assert.equal(cached.catalog, undefined);
          assert.ok(Buffer.byteLength(JSON.stringify(cached)) < 1024);
        }
      });
    });
  }

  it('denies anonymous calls and direct reads under both policies', async () => {
    await as(db, null, async () => {
      for (const sql of [
        'select public.catalog_snapshot()',
        `select public.supplier_detail('${SUPPLIER}')`,
        'select private.editable_version_ids()',
        'select * from public.memberships',
      ])
        await assert.rejects(db.query(sql), /permission denied/);
    });
  });

  it('uses invoker functions except for the private editable-version helper', async () => {
    const result = await db.query<{ proname: string; prosecdef: boolean }>(`
      select proname, prosecdef from pg_proc
      where proname in ('catalog_snapshot', 'supplier_detail', 'editable_version_ids',
        'bump_catalog_version', 'catalog_rows', 'catalog_suppliers') order by proname`);
    assert.deepEqual(
      result.rows.map((row) => [row.proname, row.prosecdef]),
      [
        ['bump_catalog_version', false],
        ['catalog_rows', false],
        ['catalog_snapshot', false],
        ['catalog_suppliers', false],
        ['editable_version_ids', true],
        ['supplier_detail', false],
      ],
    );
  });

  it('increments once per statement on every catalog table, including rolled-back writes', async () => {
    const tables = [
      'suppliers',
      'supplier_names',
      'memberships',
      'supplier_contacts',
      'registries',
      'registry_versions',
      'registry_fields',
      'categories',
      'registry_field_categories',
      'org_units',
      'source_documents',
      'supplier_identifiers',
      'identifier_candidates',
      'venue_specs',
    ];
    for (const table of tables) {
      const before = await as(db, USERS.admin, () => snapshot(db));
      const column = table === 'registry_field_categories' ? 'category_id' : 'id';
      await db.exec(`update public.${table} set ${column} = ${column}`);
      const after = await as(db, USERS.admin, () => snapshot(db, before.version));
      assert.equal(Number(after.version.split(':')[0]), Number(before.version.split(':')[0]) + 1);
      assert.equal(after.unchanged, undefined);
      await db.exec(`begin; delete from public.${table} where false; rollback`);
      const rollback = await as(db, USERS.admin, () => snapshot(db, after.version));
      assert.equal(rollback.unchanged, true);
    }
    const triggers = await db.query<{ n: number }>(`select count(*)::int as n from pg_trigger
      where tgname = 'catalog_version' and tgtype = 60`);
    assert.equal(triggers.rows[0]?.n, tables.length);
    const counter = 'select counter::int as n from private.catalog_version';
    const start = (await db.query<{ n: number }>(counter)).rows[0]?.n ?? 0;
    await db.exec('begin; truncate public.registry_field_categories');
    const truncated = (await db.query<{ n: number }>(counter)).rows[0]?.n;
    await db.exec('rollback');
    assert.equal(truncated, start + 1, 'a truncate also invalidates cached catalogs');
  });

  it('invalidates after a grant changes, is revoked, or the profile is blocked', async () => {
    const before = await as(db, USERS.editor, () => snapshot(db));
    await db.exec(`update public.role_grants set revoked_at = now()
      where user_id = '${USERS.editor}' and revoked_at is null;
      insert into public.role_grants (user_id, role, unit_id)
      values ('${USERS.editor}', 'editor', '${UNIT_2}')`);
    const moved = await as(db, USERS.editor, () => snapshot(db, before.version));
    assert.notEqual(moved.version, before.version);
    assert.equal(moved.unchanged, undefined);
    await db.exec(`update public.role_grants set revoked_at = now()
      where user_id = '${USERS.editor}' and revoked_at is null`);
    const revoked = await as(db, USERS.editor, () => snapshot(db, moved.version));
    assert.notEqual(revoked.version, moved.version);
    assert.equal(revoked.catalog, undefined);
    await db.exec(`update public.profiles set status = 'blocked'
      where user_id = '${USERS.editor}'`);
    const blocked = await as(db, USERS.editor, () => snapshot(db, revoked.version));
    assert.notEqual(blocked.version, revoked.version);
    assert.equal(blocked.access.state, 'blocked');
  });

  it('bumps for an authenticated writer but prevents direct counter manipulation', async () => {
    await as(db, USERS.admin, async () => {
      const before = await snapshot(db);
      // An admin's checked rename is saved at once.
      const change = { supplier_id: SUPPLIER, kind: 'rename', value: 'שם חדש', reason: 'תיקון' };
      await db.query('select public.submit_supplier_change($1::jsonb)', [JSON.stringify(change)]);
      const changed = await snapshot(db);
      assert.notEqual(changed.version, before.version);
      await db.exec('update private.catalog_version set counter = 1');
      assert.equal((await snapshot(db)).version, changed.version);
      await assert.rejects(db.exec('delete from private.catalog_version'), /permission denied/);
      await assert.rejects(
        db.exec('insert into private.catalog_version default values'),
        /permission denied/,
      );
    });
  });

  it('returns identifiers under RLS and the change history only to administrators', async () => {
    await db.exec(`insert into public.supplier_names (supplier_id, name)
      values ('${SUPPLIER}', 'שם שנמחק');
      delete from public.supplier_names where name = 'שם שנמחק'`);
    for (const [role, user] of Object.entries(USERS)) {
      await as(db, user, async () => {
        const detail = (
          await db.query<{ value: { identifiers: unknown[]; audit: unknown } }>(
            'select public.supplier_detail($1) as value',
            [SUPPLIER],
          )
        ).rows[0]?.value;
        const direct = await db.query<{ row: unknown }>(
          `select to_jsonb(i) as row from public.supplier_identifiers i
          where supplier_id = $1 order by id`,
          [SUPPLIER],
        );
        assert.ok(detail);
        assert.deepEqual(
          detail.identifiers,
          direct.rows.map((entry) => entry.row),
        );
        if (role === 'admin') {
          assert.ok(Array.isArray(detail.audit));
          const deleted = detail.audit as { operation: string; changes: object }[];
          assert.ok(deleted.some((row) => row.operation === 'DELETE'));
        } else assert.equal(detail.audit, null);
      });
    }
  });
});

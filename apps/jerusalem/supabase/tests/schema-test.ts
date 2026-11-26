import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { count, migratedDatabase } from './pglite.ts';

describe('migrations on an empty database', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
  });
  after(async () => {
    await db.close();
  });

  it('enables RLS on every public table', async () => {
    const open = await db.query<{ name: string }>(`
      select c.relname as name from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and not c.relrowsecurity`);
    assert.deepEqual(open.rows, []);
  });

  it('grants nothing to anon', async () => {
    const grants = `
      select table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'`;
    assert.equal(await count(db, grants), 0);
  });

  it('gives signed-in users no truncate, trigger or references rights', async () => {
    const grants = await db.query<{ grant: string }>(`
      select table_name || ':' || grantee || ':' || privilege_type as grant
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
        and privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`);
    assert.deepEqual(grants.rows, []);
  });

  it('gives a new public table no rights by default', async () => {
    await db.exec('create table public.default_grants_probe (id int)');
    const grants = `
      select 1 from information_schema.role_table_grants
      where table_name = 'default_grants_probe' and grantee in ('anon', 'authenticated')`;
    assert.equal(await count(db, grants), 0);
    await db.exec('drop table public.default_grants_probe');
  });

  it('indexes every foreign key', async () => {
    const missing = await db.query<{ fk: string }>(`
      select c.conrelid::regclass || '.' || c.conname as fk
      from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey
        )`);
    assert.deepEqual(missing.rows, []);
  });

  it('keeps every helper function out of reach of anon', async () => {
    const callable = `
      select p.proname from pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and has_function_privilege('anon', p.oid, 'execute')`;
    assert.equal(await count(db, callable), 0);
  });

  it('normalizes Hebrew supplier names', async () => {
    const result = await db.query<{ a: string; b: string }>(`
      select private.normalize_name('חברת "אבג" בע"מ') as a,
        private.normalize_name('חברת אבג  בע״מ') as b`);
    assert.deepEqual(result.rows[0], { a: 'חברת אבג', b: 'חברת אבג' });
  });

  it('rejects overlapping threshold periods', async () => {
    const row = (from: string, until: string) => `
      insert into public.thresholds (valid_from, valid_until, no_tender_max, zuta4_max,
        zuta6_max, source) values ('${from}', '${until}', 1, 2, 3, 'test')`;
    await db.exec(row('2030-10-16', '2030-11-15'));
    await assert.rejects(db.exec(row('2030-11-01', '2030-12-15')));
    await db.exec(row('2030-11-16', '2030-12-15'));
  });

  it('covers each day from 2024 through the latest published index exactly once', async () => {
    const result = await db.query<{ day: string; matches: number }>(`
      select d::date::text as day, count(t.id)::int as matches
      from generate_series('2024-01-01'::date, '2026-11-15'::date, '1 day') d
      left join public.thresholds t on d::date between t.valid_from and t.valid_until
      group by d having count(t.id) <> 1`);
    assert.deepEqual(result.rows, []);
  });

  it('records a source and reproduces the calculated amounts', async () => {
    const result = await db.query<{ valid_from: string }>(`
      select valid_from::text from public.thresholds where source is null or trim(source) = ''
        or (index_value is not null and (
          no_tender_max <> round(26000 * index_value / 175.3 / 100) * 100
          or zuta4_max <> round(63500 * index_value / 175.3 / 100) * 100
          or zuta6_max <> round(127000 * index_value / 175.3 / 100) * 100))`);
    assert.deepEqual(result.rows, []);
  });
});

describe('hierarchy guards', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
  });
  after(async () => {
    await db.close();
  });

  it('keeps units and categories to two levels', async () => {
    await db.exec(`
      insert into public.org_units (id, name, kind) values
        ('00000000-0000-0000-0000-0000000000a1', 'מינהל', 'administration');
      insert into public.org_units (id, name, kind, parent_id) values
        ('00000000-0000-0000-0000-0000000000a2', 'אגף', 'department',
          '00000000-0000-0000-0000-0000000000a1');
      insert into public.categories (id, name) values
        ('00000000-0000-0000-0000-0000000000c1', 'תכנון');
      insert into public.categories (id, name, parent_id) values
        ('00000000-0000-0000-0000-0000000000c2', 'תנועה', '00000000-0000-0000-0000-0000000000c1')`);
    const deepUnit = `insert into public.org_units (name, kind, parent_id)
      values ('מדור', 'department', '00000000-0000-0000-0000-0000000000a2')`;
    await assert.rejects(db.exec(deepUnit), /administration/);
    const deepCategory = `insert into public.categories (name, parent_id)
      values ('רמזורים', '00000000-0000-0000-0000-0000000000c2')`;
    await assert.rejects(db.exec(deepCategory), /top-level/);
  });

  it('does not bring a revoked grant back', async () => {
    await db.exec(`
      insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b1');
      insert into public.role_grants (id, user_id, role, revoked_at) values
        ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1',
          'admin', now())`);
    const revive = `update public.role_grants set revoked_at = null
      where id = '00000000-0000-0000-0000-0000000000b2'`;
    await assert.rejects(db.exec(revive), /revoked/);
  });
});

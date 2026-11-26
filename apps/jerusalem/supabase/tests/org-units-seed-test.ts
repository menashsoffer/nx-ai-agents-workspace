import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { applyMigrations, count, migratedDatabase } from './pglite.ts';

const PRIOR = '20261117090000_web_telemetry.sql';
const SEED = '20261117100000_org_units_from_site.sql';
const SPORT = '7d28baab-f5ad-4583-9b10-62733a81c2f7';
const LEGAL = 'a71241e2-454d-4d43-8f36-d9e404e8f8d3';
const PLANNING = 'c056e833-4c83-4e7d-88ca-1fdc856d3613';
const SURVEYORS = '42cda5a1-f528-473b-b3ad-1c84283fd002';

async function owner(db: PGlite, id: string): Promise<string | null> {
  const result = await db.query<{ name: string | null }>(
    `select u.name from public.registries r left join public.org_units u on u.id = r.owner_unit_id
     where r.id = $1`,
    [id],
  );
  return result.rows[0]?.name ?? null;
}

describe('municipal units from the site', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase({ until: PRIOR });
    await db.exec(`insert into public.registries (id, name) values
      ('${SPORT}', 'מאגר יועצים אגף הספורט (2021)'),
      ('${LEGAL}', 'הליך שליחויות - אגף היועץ המשפטי'),
      ('${PLANNING}', 'מאגר יועצים אגף תכנון - 2024'),
      ('${SURVEYORS}', 'מאגר מודדים')`);
  });
  after(async () => db.close());

  it('refuses a registry whose name changed', async () => {
    await db.query('update public.registries set name = $1 where id = $2', ['renamed', SPORT]);
    await assert.rejects(applyMigrations(db, { after: PRIOR, until: SEED }), /snapshot differs/);
    assert.equal(await count(db, 'select 1 from public.org_units'), 0);
    await db.query('update public.registries set name = $1 where id = $2', [
      'מאגר יועצים אגף הספורט (2021)',
      SPORT,
    ]);
  });

  it('adds two levels of unverified units with their source', async () => {
    await applyMigrations(db, { after: PRIOR, until: SEED });
    assert.equal(
      await count(db, `select 1 from public.org_units where kind = 'administration'`),
      11,
    );
    assert.equal(
      await count(
        db,
        `select 1 from public.org_units d join public.org_units a on a.id = d.parent_id
         where d.name = 'אגף הספורט' and a.name = 'מינהל תרבות חברה וספורט'`,
      ),
      1,
    );
    assert.equal(
      await count(db, `select 1 from public.org_units where verified or source_url is null`),
      0,
    );
  });

  it('sets stated and approved owners and leaves the rest for review', async () => {
    assert.equal(await owner(db, SPORT), 'אגף הספורט');
    assert.equal(await owner(db, LEGAL), 'מינהל היועץ המשפטי');
    assert.equal(await owner(db, PLANNING), 'אגף תכנון עיר');
    assert.equal(await owner(db, SURVEYORS), null);
  });
});

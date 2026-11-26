import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS, VERSION } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

const HALL = { registry: 'מאגר', name: 'ספק', capacity: 180, capacity_text: '180 מקומות' };
const FULL = { hall_size: null, stage_size: null, screen: null, sound: 'יש', lighting: null };

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function load(db: PGlite, user: string, rows: unknown[]) {
  return as(db, user, async () => {
    const result = await db.query<{ value: { matched: number; unmatched: unknown[] } }>(
      'select public.import_venue_specs($1::jsonb) as value',
      [JSON.stringify({ rows })],
    );
    return result.rows[0]?.value;
  });
}

function venueColumn(db: PGlite, user: string) {
  return as(db, user, async () => {
    const result = await db.query<{ value: { catalog: { suppliers: unknown[][] } } }>(
      'select public.catalog_snapshot() as value',
    );
    return result.rows[0]?.value.catalog.suppliers.find((row) => row[0] === SUPPLIER)?.[12];
  });
}

describe('venue specs', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.memberships (supplier_id, registry_version_id)
      values ('${SUPPLIER}', '${VERSION}')`);
  });
  after(async () => {
    await db.close();
  });

  it('lets only an admin load venue details', async () => {
    for (const user of [USERS.editor, USERS.manager, USERS.viewer, USERS.auditor]) {
      assert.equal(await errorCode(load(db, user, [HALL])), '42501');
    }
    const direct = as(db, USERS.editor, () =>
      db.query(`insert into public.venue_specs (supplier_id) values ('${SUPPLIER}')`),
    );
    assert.equal(await errorCode(direct), '42501');
  });

  it('matches the hall by registry and published name and reports the rest', async () => {
    const result = await load(db, USERS.admin, [
      { ...HALL, ...FULL, survey_year: 2024 },
      { ...HALL, name: 'אולם אחר', survey_year: 2024 },
    ]);
    assert.ok(result);
    assert.equal(result.matched, 1);
    assert.deepEqual(result.unmatched, [{ registry: 'מאגר', name: 'אולם אחר', suppliers: 0 }]);
    assert.deepEqual(await venueColumn(db, USERS.viewer), [
      180,
      '180 מקומות',
      null,
      null,
      null,
      'יש',
      null,
      2024,
    ]);
  });

  it('keeps a newer survey when an older one is loaded again', async () => {
    await load(db, USERS.admin, [{ ...HALL, capacity: 90, survey_year: 2021 }]);
    const column = (await venueColumn(db, USERS.viewer)) as unknown[];
    assert.equal(column[0], 180);
    assert.equal(
      await as(db, USERS.otherViewer, () => count(db, 'select 1 from public.venue_specs')),
      1,
    );
    assert.equal(
      await as(db, USERS.pending, () => count(db, 'select 1 from public.venue_specs')),
      0,
    );
  });

  it('ships a venues file without contact details or identifiers', async () => {
    const raw = await readFile(
      new URL('../../data/pool-file/venues.json', import.meta.url),
      'utf8',
    );
    const file = JSON.parse(raw) as { rows: Record<string, unknown>[] };
    assert.equal(file.rows.length, 119);
    const keys = new Set(file.rows.flatMap((row) => Object.keys(row)));
    for (const key of ['phone', 'email', 'person', 'value', 'scheme']) assert.ok(!keys.has(key));
  });
});

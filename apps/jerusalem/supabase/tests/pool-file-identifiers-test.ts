import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

interface Report {
  rows: number;
  matched_rows: number;
  matched_suppliers: number;
  inserted: number;
  unmatched: string[];
}

const OTHER = '40000000-0000-0000-0000-000000000002';
const MERGED = '40000000-0000-0000-0000-000000000003';

const FILE = [
  // Matches the trade name after normalization (quotes and the company suffix).
  { scheme: 'company', value: '515301596', names: ['ספק מקור', 'שם "מסחרי" בע"מ'] },
  // The supplier already has this number, so it is not offered again.
  { scheme: 'company', value: '512345678', names: ['ספק'] },
  // A short personal number is padded to nine digits.
  { scheme: 'personal_id', value: '7654321', names: ['ספק שני'] },
  // Only a merged supplier has this name.
  { scheme: 'company', value: '514000001', names: ['ספק ממוזג'] },
  { scheme: 'nonprofit', value: '580000001', names: ['לא קיים'] },
];

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function load(db: PGlite, user: string, found: unknown[]): Promise<Report | undefined> {
  return as(db, user, async () => {
    const result = await db.query<{ report: Report }>(
      'select public.import_identifier_candidates($1) as report',
      [JSON.stringify(found)],
    );
    return result.rows[0]?.report;
  });
}

describe('identifier candidates from a pool file', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`
      insert into public.supplier_names (supplier_id, name, kind)
        values ('${SUPPLIER}', 'שם מסחרי', 'trade_name');
      insert into public.suppliers (id, display_name) values ('${OTHER}', 'ספק שני');
      insert into public.suppliers (id, display_name, status, merged_into_id)
        values ('${MERGED}', 'ספק ממוזג', 'merged', '${SUPPLIER}');`);
  });
  after(async () => {
    await db.close();
  });

  it('lets only an administrator load a file', async () => {
    assert.equal(await errorCode(load(db, USERS.editor, FILE)), '42501');
    assert.equal(await errorCode(load(db, USERS.manager, FILE)), '42501');
    assert.equal(await errorCode(load(db, USERS.viewer, FILE)), '42501');
  });

  it('stores pending candidates for matching names and reports the rest', async () => {
    const report = await load(db, USERS.admin, FILE);
    assert.deepEqual(report, {
      rows: 5,
      matched_rows: 3,
      matched_suppliers: 2,
      inserted: 2,
      unmatched: ['ספק ממוזג', 'לא קיים'],
    });
    const stored = await db.query<{ supplier_id: string; value: string; source: string }>(
      `select supplier_id, value, source from public.identifier_candidates
       where status = 'pending' order by value`,
    );
    assert.deepEqual(stored.rows, [
      { supplier_id: OTHER, value: '007654321', source: 'pool_file' },
      { supplier_id: SUPPLIER, value: '515301596', source: 'pool_file' },
    ]);
  });

  it('does not store a candidate twice or reopen a decided one', async () => {
    await db.exec(`update public.identifier_candidates set status = 'dismissed'
      where value = '515301596'`);
    const report = await load(db, USERS.admin, FILE);
    assert.equal(report?.inserted, 0);
    assert.equal(await count(db, 'select 1 from public.identifier_candidates'), 2);
    assert.equal(
      await count(db, "select 1 from public.identifier_candidates where status = 'dismissed'"),
      1,
    );
  });

  it('turns an accepted file candidate into an identifier that still needs review', async () => {
    const pending = await db.query<{ id: string }>(
      "select id from public.identifier_candidates where value = '007654321'",
    );
    const id = pending.rows[0]?.id;
    assert.ok(id);
    await as(db, USERS.admin, () =>
      db.query('select public.decide_identifier_candidate($1, true)', [id]),
    );
    const added = await db.query<{ scheme: string; source: string; review_status: string }>(
      "select scheme, source, review_status from public.supplier_identifiers where value = '007654321'",
    );
    assert.deepEqual(added.rows, [
      { scheme: 'personal_id', source: 'pool_file', review_status: 'needs_review' },
    ]);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

const HALLS = {
  name: 'מאגר אולמות',
  url: 'https://www.jerusalem.muni.il/media/z/halls.pdf',
  rows: [{ key: 'HALL', name: 'אולם', names: ['אולם'], note: 'קיבולת / תכולה: 180 מקומות' }],
};

const SITE_POOL = {
  name: 'מאגר',
  rows: [
    {
      key: 'SUP-1',
      name: 'ספק',
      names: ['ספק בע"מ'],
      phones: ['02-7654321'],
      scheme: 'company',
      value: '515301596',
    },
    { key: 'SUP-2', name: 'כפול', names: ['כפול'], emails: ['x@example.com'] },
    { key: 'SUP-3', name: 'אין כזה', names: ['אין כזה'], emails: ['y@example.com'] },
  ],
};

interface Call {
  user: string;
  fn: 'import_pool_registry' | 'import_pool_contacts';
  file: unknown;
}

function run(db: PGlite, { user, fn, file }: Call) {
  return as(db, user, async () => {
    const result = await db.query<{ report: Record<string, number> }>(
      `select public.${fn}($1) as report`,
      [JSON.stringify(file)],
    );
    return result.rows[0]?.report;
  });
}

describe('the rest of the pool file', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.suppliers (display_name) values ('כפול'), ('כפול בע"מ')`);
  });
  after(async () => {
    await db.close();
  });

  it('keeps a hall row details as the membership note', async () => {
    await run(db, { user: USERS.admin, fn: 'import_pool_registry', file: HALLS });
    const note = await db.query<{ note: string }>(
      `select m.note from public.memberships m join public.suppliers s on s.id = m.supplier_id
       where s.display_name = 'אולם'`,
    );
    assert.deepEqual(note.rows, [{ note: 'קיבולת / תכולה: 180 מקומות' }]);
  });

  it('lets only an administrator add contacts from the file', async () => {
    await assert.rejects(
      run(db, { user: USERS.editor, fn: 'import_pool_contacts', file: SITE_POOL }),
      {
        code: '42501',
      },
    );
  });

  it('adds contacts only to a supplier its names identify alone', async () => {
    const suppliers = await count(db, 'select 1 from public.suppliers');
    const report = await run(db, {
      user: USERS.admin,
      fn: 'import_pool_contacts',
      file: SITE_POOL,
    });
    assert.deepEqual(report, { matched: 1, unmatched: 1, ambiguous: 1, contacts: 1 });
    const phones = await db.query<{ supplier_id: string }>(
      "select supplier_id from public.supplier_contacts where kind = 'phone'",
    );
    assert.deepEqual(phones.rows, [{ supplier_id: SUPPLIER }]);
    assert.equal(await count(db, "select 1 from public.supplier_contacts where kind = 'email'"), 0);
    assert.equal(await count(db, 'select 1 from public.suppliers'), suppliers);
  });

  it('adds nothing twice when the same file runs again', async () => {
    const report = await run(db, {
      user: USERS.admin,
      fn: 'import_pool_contacts',
      file: SITE_POOL,
    });
    assert.equal(report?.contacts, 0);
  });
});

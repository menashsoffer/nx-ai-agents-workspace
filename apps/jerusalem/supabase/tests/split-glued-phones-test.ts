import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER } from './access-fixture.ts';
import { applyMigrations, migratedDatabase } from './pglite.ts';

// The data fix of 22.11.2026 matches production rows by id and text, so the test seeds rows
// with three of its ids before the migration runs.
const FIX = '20261123110000';
const PRIMARY = '00469493-3ff8-4440-a9a2-295339977219';
const HALF_KNOWN = '0583e357-2064-40fd-9570-042274ce2de8';
const EDITED = '063e66e4-86f0-4459-a851-d4f9653ba0ac';

const SEED = `
  insert into public.supplier_contacts (id, supplier_id, kind, value, is_primary) values
    ('${PRIMARY}', '${SUPPLIER}', 'phone', '02-9709105 , 050-5260834', true),
    ('${HALF_KNOWN}', '${SUPPLIER}', 'phone', '052-3867697 , 077-5503115', false),
    ('${EDITED}', '${SUPPLIER}', 'phone', '050-9969696', false),
    (gen_random_uuid(), '${SUPPLIER}', 'phone', '052-3867697', false);
`;

interface Phone {
  value: string;
  status: string;
  is_primary: boolean;
}

describe('splitting phones stored as two numbers in one value', () => {
  let db: PGlite;
  let phones: Phone[];
  before(async () => {
    db = await migratedDatabase({ until: FIX });
    await db.exec(ACCESS_FIXTURE);
    await db.exec(SEED);
    await applyMigrations(db, { after: FIX });
    const result = await db.query<Phone>(
      `select value, status, is_primary from public.supplier_contacts
       where supplier_id = $1 and kind = 'phone' order by value`,
      [SUPPLIER],
    );
    phones = result.rows;
  });
  after(async () => {
    await db.close();
  });

  const find = (value: string) => phones.find((p) => p.value === value);

  it('marks the combined rows outdated instead of deleting them', () => {
    assert.equal(find('02-9709105 , 050-5260834')?.status, 'outdated');
    assert.equal(find('052-3867697 , 077-5503115')?.status, 'outdated');
  });

  it('adds each number as its own current phone, once', () => {
    for (const value of ['02-9709105', '050-5260834', '077-5503115', '052-3867697']) {
      assert.equal(find(value)?.status, 'current', value);
    }
    assert.equal(phones.filter((p) => p.value === '052-3867697').length, 1);
  });

  it('moves the primary mark to the first number', () => {
    assert.deepEqual(
      phones.filter((p) => p.is_primary).map((p) => p.value),
      ['02-9709105'],
    );
  });

  it('leaves a row whose text was already edited', () => {
    assert.equal(find('050-9969696')?.status, 'current');
  });
});

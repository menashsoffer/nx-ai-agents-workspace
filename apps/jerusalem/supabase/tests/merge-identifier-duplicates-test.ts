import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { applyMigrations, migratedDatabase } from './pglite.ts';

// The data fix of 22.11.2026 merges production rows by id, so the test seeds one full pair
// and one source whose target does not exist before the migration runs.
const FIX = '20261123170000';
const SOURCE = 'efe67c0f-e35a-465f-859f-d333c5787be6';
const TARGET = '06db6fa5-dc61-4be1-a0a7-cf86b7318dd2';
const LONELY = '030ac436-cc19-4d86-b20f-019fc6037969';

const SEED = `
  insert into public.suppliers (id, display_name) values
    ('${SOURCE}', 'ספק כפול'), ('${TARGET}', 'ספק מקורי בע"מ'), ('${LONELY}', 'ספק בודד');
  insert into public.supplier_identifiers (supplier_id, scheme, value)
    values ('${TARGET}', 'company', '512345678');
  insert into public.supplier_contacts (supplier_id, kind, value) values
    ('${SOURCE}', 'phone', '02-6291111'), ('${TARGET}', 'phone', '02-6292222');
`;

interface Supplier {
  id: string;
  status: string;
  merged_into_id: string | null;
}

describe('merging suppliers that share a registrar number', () => {
  let db: PGlite;
  let suppliers: Supplier[];
  before(async () => {
    db = await migratedDatabase({ until: FIX });
    await db.exec(SEED);
    await applyMigrations(db, { after: FIX });
    const result = await db.query<Supplier>(
      'select id, status, merged_into_id from public.suppliers where id = any($1)',
      [[SOURCE, TARGET, LONELY]],
    );
    suppliers = result.rows;
  });
  after(async () => {
    await db.close();
  });

  const find = (id: string) => suppliers.find((s) => s.id === id);

  it('marks the duplicate merged into the supplier holding the number', () => {
    assert.equal(find(SOURCE)?.status, 'merged');
    assert.equal(find(SOURCE)?.merged_into_id, TARGET);
    assert.equal(find(TARGET)?.status, 'active');
  });

  it('keeps the duplicate name and contacts on the target', async () => {
    const names = await db.query<{ name: string }>(
      'select name from public.supplier_names where supplier_id = $1',
      [TARGET],
    );
    assert.ok(names.rows.some((n) => n.name === 'ספק כפול'));
    const phones = await db.query<{ value: string }>(
      'select value from public.supplier_contacts where supplier_id = $1 order by value',
      [TARGET],
    );
    assert.deepEqual(
      phones.rows.map((p) => p.value),
      ['02-6291111', '02-6292222'],
    );
  });

  it('leaves a supplier whose pair is missing', () => {
    assert.equal(find(LONELY)?.status, 'active');
    assert.equal(find(LONELY)?.merged_into_id, null);
  });
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';

import { count, migratedDatabase } from './pglite.ts';

const SEED = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'dummy.sql');

describe('dummy seed for local and staging databases', () => {
  let db: PGlite;
  let seed: string;
  before(async () => {
    db = await migratedDatabase();
    seed = await readFile(SEED, 'utf8');
    await db.exec(seed);
  });
  after(async () => {
    await db.close();
  });

  it('loads suppliers with memberships after all migrations', async () => {
    assert.equal(await count(db, 'select 1 from public.suppliers'), 3);
    assert.equal(await count(db, 'select 1 from public.memberships'), 3);
  });

  it('can run again without duplicating rows', async () => {
    await db.exec(seed);
    assert.equal(await count(db, 'select 1 from public.suppliers'), 3);
    assert.equal(await count(db, 'select 1 from public.registry_field_categories'), 2);
  });

  it('uses only invented links', async () => {
    const links = await count(
      db,
      "select 1 from public.source_documents where url not like 'https://example.test/%'",
    );
    assert.equal(links, 0);
  });
});

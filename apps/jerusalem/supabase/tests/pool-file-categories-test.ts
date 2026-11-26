import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { applyMigrations, count, migratedDatabase } from './pglite.ts';

const PRIOR = '20261117100000_org_units_from_site.sql';
const SEED = '20261117110000_pool_file_categories.sql';
const SAFETY = 'e8434a27-ec1c-431c-a942-55491de820dc';
const HALLS = 'e543738f-c92d-4d18-b519-6afec03d2a2f';
const EMERGENCY = '34e59b6e-3279-4250-a585-08e7cd1d4e2f';
const TRUNCATED = '4a507601-3355-49a6-9096-8d86639ddad4';
const FIELDS: [string, string][] = [
  [SAFETY, 'יועץ בטיחות'],
  [HALLS, 'אולמות לאירועי תרבות'],
  [EMERGENCY, 'כתיבת נהלי עירוניים בתחום החרום; כתיבת תיק אב; הכנת מכרזים'],
  [TRUNCATED, 'יועץ'],
];

async function categoriesOf(db: PGlite, field: string): Promise<string[]> {
  const result = await db.query<{ name: string }>(
    `select coalesce(p.name || ' / ', '') || c.name as name
     from public.registry_field_categories l
     join public.categories c on c.id = l.category_id
     left join public.categories p on p.id = c.parent_id
     where l.registry_field_id = $1 order by 1`,
    [field],
  );
  return result.rows.map((row) => row.name);
}

describe('pool-file field categories', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase({ until: PRIOR });
    await db.exec(`insert into public.registries (id, name)
      values ('70000000-0000-0000-0000-000000000001', 'registry');
      insert into public.categories (id, name)
      values ('70000000-0000-0000-0000-000000000002', 'בטיחות ונגישות'),
        ('70000000-0000-0000-0000-000000000003', 'מכרזים, כספים ובקרה');
      insert into public.categories (name, parent_id)
      values ('בטיחות', '70000000-0000-0000-0000-000000000002'),
        ('מכרזים ורכש', '70000000-0000-0000-0000-000000000003');`);
    for (const [id, text] of FIELDS) {
      await db.query(
        `insert into public.registry_fields (id, registry_id, source_text)
         values ($1, '70000000-0000-0000-0000-000000000001', $2)`,
        [id, text],
      );
    }
  });
  after(async () => db.close());

  it('refuses a field whose text changed', async () => {
    await db.query('update public.registry_fields set source_text = $1 where id = $2', [
      'changed',
      SAFETY,
    ]);
    await assert.rejects(applyMigrations(db, { after: PRIOR, until: SEED }), /snapshot differs/);
    assert.equal(await count(db, 'select 1 from public.registry_field_categories'), 0);
    await db.query('update public.registry_fields set source_text = $1 where id = $2', [
      'יועץ בטיחות',
      SAFETY,
    ]);
  });

  it('links existing subcategories and new top-level categories', async () => {
    await applyMigrations(db, { after: PRIOR, until: SEED });
    assert.deepEqual(await categoriesOf(db, SAFETY), ['בטיחות ונגישות / בטיחות']);
    assert.deepEqual(await categoriesOf(db, HALLS), ['אולמות ומתקנים לאירועים']);
    assert.deepEqual(await categoriesOf(db, EMERGENCY), [
      'חירום וביטחון',
      'מכרזים, כספים ובקרה / מכרזים ורכש',
    ]);
  });

  it('leaves data-issue fields alone and is safe to run again', async () => {
    assert.deepEqual(await categoriesOf(db, TRUNCATED), []);
    const before = await count(db, 'select 1 from public.registry_field_categories');
    await applyMigrations(db, { after: PRIOR, until: SEED });
    assert.equal(await count(db, 'select 1 from public.registry_field_categories'), before);
  });
});

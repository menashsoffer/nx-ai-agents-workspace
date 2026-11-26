import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { applyMigrations, count, migratedDatabase, migrationNames } from './pglite.ts';

const FIX = '20261123130000_remaining_field_categories.sql';
// The migration just before FIX, so the tests run only FIX however many come before it.
const names = await migrationNames();
const PRIOR = names[names.indexOf(FIX) - 1] ?? '';
const REGISTRY = '5b070406-1c75-4c34-a587-7c9631325a26';
const VERSION = '71000000-0000-0000-0000-000000000001';
const TRUNCATED = '4a507601-3355-49a6-9096-8d86639ddad4';
const ACCESS = '52ff9778-50a0-425a-b422-fb25fee83dce';
const SURVEYS = '71000000-0000-0000-0000-000000000002';
const HYDRO = '385cbaa7-9cf7-4777-a66e-35adabf1afa0';
const SEALING = '0f16743f-f1f6-480d-8796-31e6fc5c3ae9';
const SOIL = 'f347de43-b20b-4c94-8755-ed1f749605e5';
const PLANNER = '3147752e-c038-4fca-8715-c84d98252e59';
const DEAN = 'c0f3511f-8f9c-4fb3-aecf-da82fdf4aec0';
const EMERGENCY = 'f879f26a-3aec-4b63-8cb4-7f8b1fb2919a';
const MOVED_TO_HYDRO = [
  '35886f88-fc08-4546-9ebe-2d3b2ea89355',
  '9d93354e-0fc6-4cc3-a2f5-b9fe11c2c846',
] as const;
const MOVED_TO_SEALING = 'e84b8966-5123-432e-8683-0b334338bcab';
const KEPT_FIELDS: [string, string][] = [
  ['54633f0a-c216-4378-a3ff-bfef4f8d19df', 'תכנון הסדרי תנועה'],
  ['53d67969-bf15-4fa1-b07d-40ea00700026', 'תכנון קונסטרוקטור'],
  [ACCESS, 'תכנון נגישות'],
];

// The repeats and their kept fields, read from the migration so the two cannot drift apart.
async function repeats(): Promise<[string, string][]> {
  const url = new URL(`../migrations/${FIX}`, import.meta.url);
  const sql = await readFile(url, 'utf8');
  const block = sql.split('insert into truncated_repeat values')[1]?.split(';')[0] ?? '';
  return [...block.matchAll(/\('([0-9a-f-]{36})', '([0-9a-f-]{36})'\)/g)].map((m) => [
    m[1] ?? '',
    m[2] ?? '',
  ]);
}

async function addField(db: PGlite, id: string, text: string) {
  await db.query(
    'insert into public.registry_fields (id, registry_id, source_text) values ($1, $2, $3)',
    [id, REGISTRY, text],
  );
}

interface Row {
  id?: string;
  field: string;
  page: number;
  supplier?: string;
}

// Adds a membership, for a new supplier unless one is given, and returns the supplier.
async function addMembership(db: PGlite, row: Row): Promise<string> {
  const { id = null, field, page } = row;
  const created = row.supplier
    ? undefined
    : await db.query<{ id: string }>(
        "insert into public.suppliers (display_name) values ('ספק') returning id",
      );
  const supplierId = row.supplier ?? created?.rows[0]?.id ?? '';
  await db.query(
    `insert into public.memberships
       (id, supplier_id, registry_version_id, registry_field_id, source_page)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5)`,
    [id, supplierId, VERSION, field, page],
  );
  return supplierId;
}

async function seedRegistry(db: PGlite): Promise<void> {
  await db.exec(`insert into public.registries (id, name) values ('${REGISTRY}', 'שפ"ע');
    insert into public.registry_versions (id, registry_id) values ('${VERSION}', '${REGISTRY}');
    insert into public.categories (name) values ('חינוך והשכלה'), ('חירום וביטחון'),
      ('אדריכלות ועיצוב'), ('בנייה ומבנים');
    insert into public.categories (name, parent_id)
    select child, id from public.categories, unnest(array['קרקע וביסוס', 'איטום', 'מערכות מבנה'])
      child where name = 'בנייה ומבנים';`);
  await addField(db, TRUNCATED, 'יועץ');
  await addField(db, SURVEYS, 'יועץ תסקירי תנועה');
  for (const [id, text] of KEPT_FIELDS) await addField(db, id, text);
  await addField(db, SOIL, 'יועצי קרקע');
  await addField(db, PLANNER, 'גיאוגרף/מתכנן ערים');
  await addField(db, DEAN, 'דיקאנית');
  await addField(db, EMERGENCY, "א'1 מתח נמוך");
}

// Each repeat sits next to the same supplier's row in the kept field, on the same page.
async function seedMemberships(db: PGlite): Promise<void> {
  const hydroRepeat = '4a6918f2-ae5d-4aaf-ac79-6c4682eba29b';
  for (const [id, kept] of await repeats()) {
    if (id === hydroRepeat) continue;
    const supplier = await addMembership(db, { field: kept, page: 4 });
    await addMembership(db, { id, field: TRUNCATED, page: 4, supplier });
  }
  const geo = await addMembership(db, { id: MOVED_TO_HYDRO[0], field: ACCESS, page: 20 });
  await addMembership(db, { id: hydroRepeat, field: TRUNCATED, page: 20, supplier: geo });
  await addMembership(db, { id: MOVED_TO_HYDRO[1], field: ACCESS, page: 20 });
  await addMembership(db, { id: MOVED_TO_SEALING, field: SURVEYS, page: 22 });
}

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

async function fieldOf(db: PGlite, membership: string): Promise<string | undefined> {
  const result = await db.query<{ f: string }>(
    'select registry_field_id as f from public.memberships where id = $1',
    [membership],
  );
  return result.rows[0]?.f;
}

describe('remaining field categories', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase({ until: PRIOR });
    await seedRegistry(db);
    await seedMemberships(db);
  });
  after(async () => db.close());

  it('lists the 32 repeats of the truncated field', async () => {
    assert.equal((await repeats()).length, 32);
  });

  it('refuses when a repeat is in use', async () => {
    const [first] = await repeats();
    await db.query(`update public.memberships set registry_field_id = $1 where id = $2`, [
      SURVEYS,
      first?.[0],
    ]);
    await assert.rejects(applyMigrations(db, { after: PRIOR, until: FIX }), /snapshot differs/);
    assert.equal(
      await count(db, `select 1 from public.registry_fields where id = '${TRUNCATED}'`),
      1,
    );
    await db.query(`update public.memberships set registry_field_id = $1 where id = $2`, [
      TRUNCATED,
      first?.[0],
    ]);
  });

  it('removes the repeats and moves pages 20 and 22', async () => {
    await applyMigrations(db, { after: PRIOR, until: FIX });
    assert.equal(
      await count(db, `select 1 from public.registry_fields where id = '${TRUNCATED}'`),
      0,
    );
    assert.equal(await count(db, 'select 1 from public.memberships'), 34);
    for (const id of MOVED_TO_HYDRO) assert.equal(await fieldOf(db, id), HYDRO);
    assert.equal(await fieldOf(db, MOVED_TO_SEALING), SEALING);
    assert.deepEqual(await categoriesOf(db, HYDRO), ['בנייה ומבנים / קרקע וביסוס']);
    assert.deepEqual(await categoriesOf(db, SEALING), ['בנייה ומבנים / איטום']);
  });

  it('links the remaining fields', async () => {
    assert.deepEqual(await categoriesOf(db, SOIL), ['בנייה ומבנים / קרקע וביסוס']);
    assert.deepEqual(await categoriesOf(db, PLANNER), ['אדריכלות ועיצוב / תכנון ערים ופרוגרמות']);
    assert.deepEqual(await categoriesOf(db, DEAN), ['חינוך והשכלה']);
    assert.deepEqual(await categoriesOf(db, EMERGENCY), ['חירום וביטחון']);
  });

  it('is safe to run again', async () => {
    const links = await count(db, 'select 1 from public.registry_field_categories');
    await applyMigrations(db, { after: PRIOR, until: FIX });
    assert.equal(await count(db, 'select 1 from public.registry_field_categories'), links);
    assert.equal(await count(db, 'select 1 from public.memberships'), 34);
  });

  it('does nothing on a database without these fields', async () => {
    const empty = await migratedDatabase({ until: FIX });
    assert.equal(
      await count(empty, `select 1 from public.categories where name = 'תכנון ערים ופרוגרמות'`),
      0,
    );
    await empty.close();
  });
});

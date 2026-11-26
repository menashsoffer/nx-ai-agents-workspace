import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { applyMigrations, count, migratedDatabase } from './pglite.ts';

const PRIOR = '20261113020000_registry_field_categories.sql';
const SEED = '20261113021000_seed_categories.sql';
const PRE_CLEANUP = '20261116020000_identifier_candidates.sql';
const CLEANUP = '20261116021000_cleanup_duplicate_road_field.sql';
const DUPLICATE = '3dfb2369-695b-47ed-9a52-d255a245bfa3';
const KEPT = 'e744ea22-d6d2-4f2f-9ca6-1c77cf148f15';
const LATER = '50000000-0000-0000-0000-0000000000ff';
const MANUAL = '40000000-0000-0000-0000-000000000001';
interface Field {
  id: string;
  registry_id: string;
  source_text: string;
}

describe('reviewed category seed', () => {
  let db: PGlite;
  let fields: Field[];
  before(async () => {
    const fixture = await readFile(
      new URL('./fixtures/category-fields.jsonl', import.meta.url),
      'utf8',
    );
    fields = fixture
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Field);
    db = await migratedDatabase({ until: PRIOR });
    const registries = [...new Set(fields.map((f) => f.registry_id))];
    for (const [index, id] of registries.entries()) {
      await db.query('insert into public.registries (id, name) values ($1, $2)', [
        id,
        `registry ${String(index)}`,
      ]);
    }
    for (const field of fields) {
      await db.query(
        'insert into public.registry_fields (id, registry_id, source_text) values ($1, $2, $3)',
        [field.id, field.registry_id, field.source_text],
      );
    }
    assert.ok(fields[0]);
    await db.exec(`insert into public.categories (id, name) values ('${MANUAL}', 'Existing manual category');
      insert into public.registry_field_categories (registry_field_id, category_id)
      values ('${fields[0].id}', '${MANUAL}')`);
  });
  after(async () => db.close());

  it('refuses a changed snapshot before adding categories', async () => {
    const first = fields[0];
    assert.ok(first);
    await db.query('update public.registry_fields set source_text = $1 where id = $2', [
      'changed',
      first.id,
    ]);
    await assert.rejects(applyMigrations(db, { after: PRIOR, until: SEED }), /snapshot differs/);
    assert.equal(await count(db, 'select 1 from public.categories'), 1);
    await db.query('update public.registry_fields set source_text = $1 where id = $2', [
      first.source_text,
      first.id,
    ]);
  });

  it('ignores source fields added after the snapshot', async () => {
    await db.query(
      'insert into public.registry_fields (id, registry_id, source_text) values ($1, $2, $3)',
      [LATER, fields[0]?.registry_id, 'field loaded later'],
    );
    await applyMigrations(db, { after: PRIOR, until: SEED });
    assert.equal(
      await count(
        db,
        `select 1 from public.registry_field_categories where registry_field_id = '${LATER}'`,
      ),
      0,
    );
  });

  it('adds the proposed links while preserving existing manual mappings', async () => {
    assert.equal(await count(db, 'select 1 from public.registry_field_categories'), 208);
    assert.equal(
      await count(
        db,
        `select 1 from public.registry_field_categories where category_id = '${MANUAL}'`,
      ),
      1,
    );
    assert.equal(await count(db, 'select 1 from public.categories where parent_id is null'), 10);
    assert.equal(
      await count(db, 'select 1 from public.categories where parent_id is not null'),
      36,
    );
    await applyMigrations(db, { after: PRIOR, until: SEED });
    assert.equal(await count(db, 'select 1 from public.registry_field_categories'), 208);
  });

  it('gives the extraction duplicate the same categories as the field it duplicates', async () => {
    const links = (field: string) =>
      db.query<{ category_id: string }>(
        `select category_id from public.registry_field_categories
         where registry_field_id = $1 order by category_id`,
        [field],
      );
    const [duplicate, kept] = await Promise.all([links(DUPLICATE), links(KEPT)]);
    assert.equal(kept.rows.length, 6);
    assert.deepEqual(duplicate.rows, kept.rows);
  });
  it('moves memberships and all category links after seeding without losing manual links', async () => {
    await applyMigrations(db, { after: SEED, until: PRE_CLEANUP });
    const field = fields.find((item) => item.id === DUPLICATE);
    assert.ok(field);
    await db.exec(`insert into public.registry_versions (id, registry_id)
      values ('60000000-0000-0000-0000-000000000001', '${field.registry_id}');
      insert into public.suppliers (id, display_name)
      values ('60000000-0000-0000-0000-000000000002', 'Test supplier');
      insert into public.memberships (supplier_id, registry_version_id, registry_field_id, source_page, note)
      values ('60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', '${DUPLICATE}', 2, 'source evidence');
      insert into public.registry_field_categories (registry_field_id, category_id)
      values ('${DUPLICATE}', '${MANUAL}');`);
    const before = await db.query<{ category_id: string }>(
      `select category_id from public.registry_field_categories where registry_field_id = $1 order by category_id`,
      [DUPLICATE],
    );
    assert.equal(before.rows.length, 7);
    await db.exec(`insert into public.suppliers (id, display_name)
      values ('60000000-0000-0000-0000-000000000003', 'יניב גורביץ מהנדסים');
      insert into public.import_batches (id, script_name) values ('60000000-0000-0000-0000-000000000004', 'test');
      insert into public.import_rows (id, batch_id, row_number, source_page, raw)
      overriding system value values (10, '60000000-0000-0000-0000-000000000004', 1, 2, '{}'),
        (11, '60000000-0000-0000-0000-000000000004', 2, 8, '{}');
      insert into public.memberships (id, supplier_id, registry_version_id, registry_field_id, source_page, import_row_id, note)
      values ('60000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000001', '${DUPLICATE}', 2, 10, 'existing note'),
        ('60000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000001', '${KEPT}', 8, 11, 'existing note');
      insert into public.memberships (supplier_id, registry_version_id, registry_field_id, source_page)
      values ('60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', '${KEPT}', 8)`);
    await assert.rejects(
      applyMigrations(db, { after: PRE_CLEANUP, until: CLEANUP }),
      /Conflicting memberships/,
    );
    assert.equal(
      await count(db, `select 1 from public.registry_fields where id = '${DUPLICATE}'`),
      1,
    );
    assert.equal(
      await count(
        db,
        `select 1 from public.registry_field_categories where registry_field_id = '${DUPLICATE}'`,
      ),
      7,
    );
    assert.equal(
      await count(
        db,
        `select 1 from public.memberships where supplier_id = '60000000-0000-0000-0000-000000000003'`,
      ),
      2,
    );
    assert.equal(
      await count(
        db,
        `select 1 from public.memberships where id = '60000000-0000-0000-0000-000000000006' and note = 'existing note'`,
      ),
      1,
    );
    await db.exec(
      `delete from public.memberships where registry_field_id = '${KEPT}' and supplier_id = '60000000-0000-0000-0000-000000000002'`,
    );
    await applyMigrations(db, { after: PRE_CLEANUP, until: CLEANUP });
    const after = await db.query<{ category_id: string }>(
      `select category_id from public.registry_field_categories where registry_field_id = $1 order by category_id`,
      [KEPT],
    );
    assert.deepEqual(after.rows, before.rows);
    const retained = await db.query<{
      id: string;
      source_page: number;
      import_row_id: string;
      note: string;
    }>(
      `select id, source_page, import_row_id::text, note from public.memberships where supplier_id = $1`,
      ['60000000-0000-0000-0000-000000000003'],
    );
    assert.equal(retained.rows.length, 1);
    assert.equal(retained.rows[0]?.id, '60000000-0000-0000-0000-000000000006');
    assert.equal(retained.rows[0].source_page, 8);
    assert.equal(retained.rows[0].import_row_id, '11');
    assert.equal(retained.rows[0].note, 'existing note מופיע גם בעמוד 2');
    assert.equal(await count(db, `select 1 from public.import_rows where id in (10, 11)`), 2);
    assert.equal(
      await count(
        db,
        `select 1 from public.audit_log where table_name = 'memberships' and row_id = '60000000-0000-0000-0000-000000000005' and operation = 'DELETE'`,
      ),
      1,
    );
    assert.equal(
      await count(db, `select 1 from public.registry_fields where id = '${DUPLICATE}'`),
      0,
    );
    assert.equal(
      await count(
        db,
        `select 1 from public.memberships where registry_field_id = '${KEPT}' and note = 'source evidence'`,
      ),
      1,
    );
    assert.equal(
      await count(
        db,
        `select 1 from public.audit_log where table_name = 'registry_fields' and row_id = '${DUPLICATE}' and operation = 'DELETE'`,
      ),
      1,
    );
    await applyMigrations(db, { after: PRE_CLEANUP, until: CLEANUP });
    assert.equal(
      await count(
        db,
        `select 1 from public.registry_field_categories where registry_field_id = '${KEPT}'`,
      ),
      7,
    );
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { ACCESS_FIXTURE, SUPPLIER, USERS, VERSION, REGISTRY } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

async function assertReopened(db: PGlite, batchId: string, rowId: number) {
  const result = await db.query<{ data: { rows: { row_id: number; candidates: unknown[] }[] } }>(
    'select public.stage_excel_import($1) as data',
    [{ batch_id: batchId }],
  );
  const first = result.rows[0]?.data.rows[0];
  assert.ok(first);
  assert.equal(first.candidates.length, 1);
  assert.equal(first.row_id, rowId);
}

describe('Excel import decisions and promotion', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.supplier_contacts (supplier_id, kind, value, is_primary)
      values ('${SUPPLIER}', 'phone', '025555555', true)`);
    await db.exec(`insert into storage.objects (bucket_id, name, metadata)
      values ('source-files', 'excel/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.xlsx', '{"size": 500}'),
        ('source-files', 'excel/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.xlsx', '{"size": 500}')`);
  });
  after(async () => {
    await db.close();
  });

  it('rejects unsupported files, oversized files and excessive row counts', async () => {
    const valid = {
      file_name: 'source.xlsx',
      storage_path: `excel/${'b'.repeat(64)}.xlsx`,
      content_sha256: 'b'.repeat(64),
      rows: [{ row_number: 1, raw: { name: 'בדיקה' }, edited: { name: 'בדיקה' } }],
    };
    await db.exec(`insert into storage.objects (bucket_id, name, metadata)
      values ('source-files', 'big.xlsx', '{"size": 5242881}')`);
    await as(db, USERS.admin, async () => {
      for (const bad of [
        { ...valid, file_name: 'macros.xlsm' },
        { ...valid, content_sha256: null },
        { ...valid, storage_path: 'big.xlsx' },
        { ...valid, rows: Array.from({ length: 5001 }, () => valid.rows[0]) },
        { ...valid, storage_path: 'elsewhere/file.xlsx' },
        { ...valid, rows: [{ row_number: 1, raw: {}, edited: { name: '=HYPERLINK("x")' } }] },
        { ...valid, rows: [{ row_number: 1, raw: {}, edited: { name: '<script>x</script>' } }] },
        { ...valid, rows: [{ row_number: 1, raw: {}, edited: { name: 'א\u202Eב' } }] },
        { ...valid, rows: [{ row_number: 1, raw: {}, edited: { owner: 'x' } }] },
        { ...valid, rows: [{ row_number: 1, raw: {}, edited: { name: 'א', phone: 5 } }] },
        { ...valid, file_name: '=cmd.xlsx' },
        { rows: valid.rows },
        [],
      ]) {
        await assert.rejects(db.query('select public.stage_excel_import($1)', [bad]));
      }
    });
  });

  it('requires admin decisions, isolates failures and does not repeat promoted rows', async () => {
    const input = {
      file_name: 'source.xlsx',
      storage_path: `excel/${'a'.repeat(64)}.xlsx`,
      content_sha256: 'a'.repeat(64),
      registry_id: REGISTRY,
      registry_version_id: VERSION,
      rows: [
        { row_number: 2, raw: { name: 'ספק' }, edited: { name: 'ספק', phone: '021234567' } },
        {
          row_number: 3,
          raw: { name: 'חדש' },
          edited: { name: 'חדש', scheme: 'personal_id', value: '012345678' },
        },
        {
          row_number: 4,
          raw: { name: 'חדש נוסף' },
          edited: { name: 'חדש נוסף', entity_kind: '', scheme: 'personal_id', value: '000001234' },
        },
      ] as const,
    };
    for (const user of [USERS.auditor, USERS.viewer, USERS.pending, USERS.blocked]) {
      await as(db, user, async () => {
        await assert.rejects(
          db.query('select public.stage_excel_import($1)', [input]),
          /authorized/i,
        );
        await assert.rejects(db.query('select public.decide_import_rows($1)', [[]]), /authorized/i);
        await assert.rejects(
          db.query('select public.apply_import_batch($1)', [VERSION]),
          /authorized/i,
        );
        assert.equal(await count(db, 'select 1 from public.import_rows'), 0);
      });
    }
    await as(db, USERS.admin, async () => {
      const result = await db.query<{
        data: { batch_id: string; rows: { row_id: number; candidates: unknown[] }[] };
      }>('select public.stage_excel_import($1) as data', [input]);
      const data = result.rows[0]?.data;
      assert.ok(data);
      const [first, second, third] = data.rows;
      assert.ok(first && second && third);
      assert.equal(first.candidates.length, 1);
      await assertReopened(db, data.batch_id, first.row_id);
      assert.equal(await count(db, 'select 1 from public.memberships'), 0);
      const held = await db.query<{ data: { pending: number } }>(
        'select public.apply_import_batch($1) as data',
        [data.batch_id],
      );
      assert.equal(held.rows[0]?.data.pending, 3);
      await db.query('select public.decide_import_rows($1)', [
        [
          {
            row_id: first.row_id,
            decision: 'link',
            target_supplier_id: SUPPLIER,
            edited: input.rows[0].edited,
          },
          { row_id: second.row_id, decision: 'new', edited: input.rows[1].edited },
          { row_id: third.row_id, decision: 'new', edited: input.rows[2].edited },
        ],
      ]);
      assert.equal(
        await count(
          db,
          `select 1 from public.import_rows where decided_by = '${USERS.admin}' and decided_at is not null`,
        ),
        3,
      );
      const applied = await db.query<{ data: { promoted: number; failed: number } }>(
        'select public.apply_import_batch($1) as data',
        [data.batch_id],
      );
      assert.deepEqual([applied.rows[0]?.data.promoted, applied.rows[0]?.data.failed], [2, 1]);
      assert.equal(await count(db, 'select 1 from public.memberships'), 2);
      assert.equal(
        await count(db, "select 1 from public.import_rows where error = 'reason:identifier_taken'"),
        1,
      );
      assert.equal(
        await count(
          db,
          "select 1 from public.identifier_candidates where value = '000001234' and source = 'excel_import' and status = 'pending'",
        ),
        1,
      );
      assert.equal(
        await count(
          db,
          `select 1 from public.supplier_contacts where supplier_id = '${SUPPLIER}' and value = '025555555' and is_primary`,
        ),
        1,
      );
      assert.equal(
        await count(
          db,
          `select 1 from public.supplier_contacts where supplier_id = '${SUPPLIER}' and value = '021234567' and not is_primary`,
        ),
        1,
      );
      assert.equal(
        await count(db, "select 1 from public.suppliers where review_status = 'verified'"),
        0,
      );
      await assert.rejects(
        db.query('select public.decide_import_rows($1)', [
          [{ row_id: third.row_id, decision: 'new', edited: { name: '@SUM(A1)' } }],
        ]),
        /reason:import_decision_invalid/,
      );
      const again = await db.query<{ data: { promoted: number } }>(
        'select public.apply_import_batch($1) as data',
        [data.batch_id],
      );
      assert.equal(again.rows[0]?.data.promoted, 0);
      assert.equal(await count(db, 'select 1 from public.memberships'), 2);
      const duplicate = await db.query<{ data: { duplicate: boolean } }>(
        'select public.stage_excel_import($1) as data',
        [input],
      );
      assert.equal(duplicate.rows[0]?.data.duplicate, true);
    });
  });
});

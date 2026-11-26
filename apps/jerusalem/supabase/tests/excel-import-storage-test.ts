import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

describe('Excel import storage and audit isolation', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('allows only an active administrator to read and upload source files', async () => {
    await as(db, USERS.admin, async () => {
      await db.exec(
        "insert into storage.objects (bucket_id, name) values ('source-files', 'a.xlsx')",
      );
      assert.equal(await count(db, "select 1 from storage.objects where name = 'a.xlsx'"), 1);
    });
    for (const user of [USERS.auditor, USERS.viewer, USERS.pending, USERS.blocked]) {
      await as(db, user, async () => {
        assert.equal(await count(db, 'select 1 from storage.objects'), 0);
        await assert.rejects(
          db.exec(
            "insert into storage.objects (bucket_id, name) values ('source-files', 'b.xlsx')",
          ),
          /row-level security/,
        );
      });
    }
    await as(db, null, async () => {
      assert.equal(await count(db, 'select 1 from storage.objects'), 0);
      await assert.rejects(
        db.exec("insert into storage.objects (bucket_id, name) values ('source-files', 'c.xlsx')"),
        /row-level security/,
      );
    });
  });

  it('does not expose edited data or source filenames in the audit log', async () => {
    await as(db, USERS.admin, async () => {
      await db.exec(`
        insert into storage.objects (bucket_id, name) values ('source-files', 'secret.xlsx');
        insert into public.source_documents (file_name, content_sha256, storage_path)
        values ('secret.xlsx', repeat('a', 64), 'secret.xlsx');
        insert into public.import_batches (script_name) values ('excel_import');
        insert into public.import_rows (batch_id, row_number, raw, edited, error)
        select id, 1, '{"name":"raw-secret"}', '{"name":"edited-secret"}', 'error-secret'
        from public.import_batches where script_name = 'excel_import';
      `);
      const deleted = await db.query(
        "delete from storage.objects where name = 'secret.xlsx' returning id",
      );
      assert.equal(deleted.rows.length, 0);
      const changed = await db.query(
        "update storage.objects set name = 'changed.xlsx' where name = 'secret.xlsx' returning id",
      );
      assert.equal(changed.rows.length, 0);
    });
    await as(db, USERS.auditor, async () => {
      assert.equal(
        await count(db, 'select 1 from public.source_documents where storage_path is not null'),
        0,
      );
      const result = await db.query<{ changes: unknown }>(
        "select changes from public.audit_log where table_name in ('import_rows', 'source_documents')",
      );
      const changes = JSON.stringify(result.rows);
      for (const secret of ['secret.xlsx', 'raw-secret', 'edited-secret', 'error-secret']) {
        assert.equal(changes.includes(secret), false);
      }
    });
  });
});

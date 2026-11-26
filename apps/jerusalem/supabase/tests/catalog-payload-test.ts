import assert from 'node:assert/strict';
import { it } from 'node:test';

import { ACCESS_FIXTURE, REGISTRY, USERS, VERSION } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

it('keeps a synthetic 533-supplier catalog below 300KB before compression', async () => {
  const db = await migratedDatabase();
  try {
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`
      insert into public.source_documents (id, url)
        values (md5('document')::uuid, 'https://example.test/source.pdf');
      update public.registry_versions set source_document_id = md5('document')::uuid
        where id = '${VERSION}';
      insert into public.registry_fields (id, registry_id, source_text)
        select md5('field' || i)::uuid, '${REGISTRY}', 'תחום לדוגמה ' || i
        from generate_series(1, 2) i;
      insert into public.suppliers (id, display_name)
        select md5('supplier' || i)::uuid, 'שם ספק דוגמה מספר ' || i
        from generate_series(1, 533) i;
      insert into public.supplier_names (supplier_id, name, source_document_id)
        select md5('supplier' || i)::uuid, 'שם ספק דוגמה מספר ' || i, md5('document')::uuid
        from generate_series(1, 533) i;
      insert into public.memberships (supplier_id, registry_version_id, registry_field_id,
        name_as_published, source_page)
        select md5('supplier' || (1 + (i - 1) % 533))::uuid, '${VERSION}',
          md5('field' || (1 + (i - 1) / 533))::uuid,
          'שם ספק דוגמה מספר ' || (1 + (i - 1) % 533), 2
        from generate_series(1, 776) i;
      insert into public.supplier_contacts (supplier_id, kind, value, source_document_id)
        select md5('supplier' || (1 + (i - 1) % 533))::uuid,
          case when i <= 533 then 'phone' else 'email' end,
          case when i <= 533 then '0501234567' else 'supplier@example.test' end,
          md5('document')::uuid from generate_series(1, 841) i;
    `);
    await as(db, USERS.admin, async () => {
      const result = await db.query<{
        bytes: number;
        snapshot: { catalog: { suppliers: unknown[] } };
      }>(`
        select octet_length(value::text) as bytes, value as snapshot
        from (select public.catalog_snapshot() as value) s`);
      const row = result.rows[0];
      assert.ok(row);
      assert.equal(row.snapshot.catalog.suppliers.length, 534);
      assert.ok(row.bytes < 300_000, `Synthetic response: ${String(row.bytes)} bytes`);
      console.info(
        `Synthetic catalog JSON (including PostgreSQL whitespace): ${String(row.bytes)} bytes`,
      );
    });
  } finally {
    await db.close();
  }
});

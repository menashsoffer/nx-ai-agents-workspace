import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { applyMigrations, count, migratedDatabase } from './pglite.ts';

const ADMIN = '10000000-0000-0000-0000-000000000001';
const TESTER = '10000000-0000-0000-0000-000000000002';
const AUTO = 'חולץ אוטומטית – יש לאמת מול המקור';

// Reproduces the patterns found in the live table: an exact duplicate, a name that
// differs only by the company suffix, "a / b" fields and dates inside notes.
const FIXTURE = `
  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
    ('${ADMIN}', 'admin@example.test', '{"role":"supplier_admin"}', '{"full_name":"דנה לוי"}'),
    ('${TESTER}', 'tester@example.test', '{}', '{}');
  insert into public.suppliers (name, field, registry, source_url, email, phone, note) values
    ('חברה א בע"מ', 'תכנון / פיקוח', 'R1', 'https://x.test/1.pdf', 'a@x.co, b@x.co',
      '02-1234567', 'קוד תחום: 12.07'),
    ('חברה א בע"מ', 'תכנון / פיקוח', 'R1', 'https://x.test/1.pdf', 'a@x.co, b@x.co',
      '02-1234567', 'קוד תחום: 12.07'),
    ('חברה א', 'תכנון', 'R1', 'https://x.test/1.pdf', 'A@x.co', null, '${AUTO}'),
    ('יועץ ב', 'ייעוץ', 'R2', 'https://x.test/2.pdf', null, null,
      'תוקף חוזה כפי שצוין במקור: 7.11.2026'),
    ('יועץ ג', 'ייעוץ', 'R2', 'https://x.test/2.pdf', 'bad-email', null,
      'על פי המסמך: תוקף המאגר עד 31.08.2027');
`;

describe('copy of the legacy suppliers table', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase({ until: '20261112000100_harden_baseline.sql' });
    await db.exec(FIXTURE);
    // Stops before the legacy table was dropped (25.11), so the copy can be checked.
    await applyMigrations(db, {
      after: '20261112000100_harden_baseline.sql',
      until: '20261125090000_revoke_stray_table_grants.sql',
    });
  });
  after(async () => {
    await db.close();
  });

  it('stages every legacy row and accounts for each one', async () => {
    assert.equal(await count(db, 'select 1 from public.import_rows'), 5);
    assert.equal(await count(db, "select 1 from public.import_rows where status = 'duplicate'"), 1);
    assert.equal(await count(db, "select 1 from public.import_rows where status = 'promoted'"), 4);
    assert.equal(await count(db, 'select 1 from public.legacy_suppliers'), 5);
  });

  it('creates one supplier per normalized name', async () => {
    assert.equal(await count(db, 'select 1 from public.suppliers'), 3);
    const names = `select 1 from public.supplier_names n
      join public.suppliers s on s.id = n.supplier_id where s.display_name = 'חברה א'`;
    assert.equal(await count(db, names), 1);
  });

  it('splits multi-field rows into memberships without duplicates', async () => {
    assert.equal(await count(db, 'select 1 from public.registry_fields'), 3);
    assert.equal(await count(db, 'select 1 from public.memberships'), 4);
    const code = await db.query<{ code: string }>(
      "select source_code as code from public.registry_fields where source_text = 'פיקוח'",
    );
    assert.equal(code.rows[0]?.code, '12.07');
  });

  it('moves dates out of the notes', async () => {
    const version = await db.query<{ until: string }>(`
      select v.valid_until::text as until from public.registry_versions v
      join public.registries r on r.id = v.registry_id where r.name = 'R2'`);
    assert.equal(version.rows[0]?.until, '2027-08-31');
    const listed = await db.query<{ until: string; source: string }>(`
      select registered_until::text as until, dates_source as source
      from public.memberships where name_as_published = 'יועץ ב'`);
    assert.deepEqual(listed.rows[0], { until: '2026-11-07', source: 'registry_document' });
  });

  it('splits contacts and flags invalid ones', async () => {
    const contacts = `select 1 from public.supplier_contacts c
      join public.suppliers s on s.id = c.supplier_id where s.display_name = 'חברה א'`;
    assert.equal(await count(db, contacts), 3);
    const invalid = "select 1 from public.supplier_contacts where not is_valid and kind = 'email'";
    assert.equal(await count(db, invalid), 1);
  });

  it('keeps today’s admin as an admin and nobody else', async () => {
    const grants = await db.query<{ user_id: string; role: string; first_name: string }>(`
      select g.user_id, g.role, p.first_name from public.role_grants g
      join public.profiles p using (user_id)`);
    assert.deepEqual(grants.rows, [{ user_id: ADMIN, role: 'admin', first_name: 'דנה' }]);
  });
});

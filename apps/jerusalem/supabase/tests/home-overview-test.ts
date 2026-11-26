import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, REGISTRY, SUPPLIER, UNIT_1, USERS, VERSION } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

const FIELD = '30000000-0000-0000-0000-000000000003';
const SECOND = '40000000-0000-0000-0000-000000000002';
const THIRD = '40000000-0000-0000-0000-000000000003';
const OPEN_REGISTRY = '30000000-0000-0000-0000-000000000004';
const OPEN_VERSION = '30000000-0000-0000-0000-000000000005';

interface Overview {
  active_suppliers: number;
  lapsed: { registry_id: string; count: number; ended_on: string }[];
  my_open_requests: number;
  kind_suggestions_pending?: number;
  registries_without_unit?: number;
  [key: string]: unknown;
}

function overview(db: PGlite, user: string | null): Promise<Overview | undefined> {
  return as(db, user, async () => {
    const result = await db.query<{ value: Overview }>('select public.home_overview() as value');
    return result.rows[0]?.value;
  });
}

describe('home overview', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`
      update public.registry_versions set valid_until = '2020-01-31' where id = '${VERSION}';
      insert into public.registries (id, name) values ('${OPEN_REGISTRY}', 'מאגר פתוח');
      insert into public.registry_versions (id, registry_id, valid_until)
        values ('${OPEN_VERSION}', '${OPEN_REGISTRY}', '2099-12-31');
      insert into public.registry_fields (id, registry_id, source_text)
        values ('${FIELD}', '${REGISTRY}', 'תכנון'),
          ('30000000-0000-0000-0000-000000000006', '${OPEN_REGISTRY}', 'תכנון');
      insert into public.suppliers (id, display_name) values ('${SECOND}', 'שני'),
        ('${THIRD}', 'שלישי');
      insert into public.memberships (supplier_id, registry_version_id, registry_field_id,
        registered_until) values
        ('${SUPPLIER}', '${VERSION}', '${FIELD}', null),
        ('${SECOND}', '${VERSION}', '${FIELD}', '2099-01-01'),
        ('${THIRD}', '${OPEN_VERSION}', '30000000-0000-0000-0000-000000000006', '2020-06-30');
      insert into public.engagement_requests (unit_id, subject, subject_key, estimated_value,
        value_includes_vat, status)
        values ('${UNIT_1}', 'ייעוץ', 'ייעוץ', 1000, true, 'draft');`);
  });
  after(async () => {
    await db.close();
  });

  it('uses the registry validity unless the supplier has its own date', async () => {
    const value = await overview(db, USERS.viewer);
    assert.deepEqual(
      value?.lapsed.map((x) => [x.registry_id, x.count, x.ended_on]),
      [
        [REGISTRY, 1, '2020-01-31'],
        [OPEN_REGISTRY, 1, '2020-06-30'],
      ],
    );
    assert.equal(value.active_suppliers, 3);
  });

  it('counts open requests only in the user’s own units', async () => {
    assert.equal((await overview(db, USERS.viewer))?.my_open_requests, 1);
    assert.equal((await overview(db, USERS.otherViewer))?.my_open_requests, 0);
    assert.equal((await overview(db, USERS.admin))?.my_open_requests, 1);
  });

  it('adds the administrator’s waiting work for an admin only', async () => {
    const admin = await overview(db, USERS.admin);
    assert.equal(admin?.registries_without_unit, 1);
    assert.equal(admin.kind_suggestions_pending, 0);
    assert.equal((await overview(db, USERS.editor))?.registries_without_unit, undefined);
  });

  it('refuses visitors and users who are not active', async () => {
    for (const user of [null, USERS.pending, USERS.blocked]) {
      await assert.rejects(
        overview(db, user),
        /Only active members|permission denied/,
        String(user),
      );
    }
  });
});

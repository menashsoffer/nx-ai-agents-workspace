import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, UNIT_2, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

const OTHER_PENDING = '10000000-0000-0000-0000-000000000099';

function overview(db: PGlite, user: string) {
  return as(db, user, async () => {
    const result = await db.query<{ value: Record<string, number> }>(
      'select public.admin_overview() as value',
    );
    return result.rows[0]?.value ?? {};
  });
}

describe('admin overview counters', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`
      insert into auth.users (id) values ('${OTHER_PENDING}');
      insert into public.profiles (user_id, first_name, last_name, email, job_title, unit_id,
        purpose) values ('${OTHER_PENDING}', 'א', 'ב', 'x@test', 'רכז', '${UNIT_2}', 'צריך גישה');
      insert into public.identifier_candidates (supplier_id, scheme, value, source, searched_name)
        values ('${SUPPLIER}', 'company', '512345679', 'companies_registrar', 'ספק');`);
  });
  after(async () => {
    await db.close();
  });

  it('gives an admin every counter', async () => {
    assert.deepEqual(await overview(db, USERS.admin), {
      users_pending: 2,
      identifiers_pending: 1,
      categories_pending: 0,
      thresholds_pending: 0,
      addresses_not_found: 0,
      supplier_links_pending: 0,
    });
  });

  it('counts for a unit manager only the sign-ups of their own unit', async () => {
    assert.deepEqual(await overview(db, USERS.manager), { users_pending: 1 });
  });

  it('gives an editor no counter: supplier ID candidates are for administrators', async () => {
    assert.deepEqual(await overview(db, USERS.editor), {});
  });

  it('gives no counter to a viewer, an auditor or someone not yet active', async () => {
    for (const user of [USERS.viewer, USERS.auditor, USERS.pending, USERS.blocked]) {
      assert.deepEqual(await overview(db, user), {}, user);
    }
  });

  it('is not open to anonymous callers', async () => {
    const result = await db.query<{ allowed: boolean }>(
      `select has_function_privilege('anon', 'public.admin_overview()', 'execute') as allowed`,
    );
    assert.equal(result.rows[0]?.allowed, false);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS, VERSION } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

interface Control {
  jobs: Record<string, unknown>[];
  batches: Record<string, unknown>[];
  registries: Record<string, unknown>[];
  candidates: Record<string, number>;
  identifiers_pending: number;
  same_names: number;
  venues: number;
}

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function control(db: PGlite, user: string) {
  return as(db, user, async () => {
    const result = await db.query<{ value: Control }>('select public.load_control() as value');
    return result.rows[0]?.value;
  });
}

describe('load control', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`
      insert into public.memberships (supplier_id, registry_version_id)
        values ('${SUPPLIER}', '${VERSION}');
      insert into public.suppliers (display_name) values (' ספק '), ('אחר');
      insert into public.job_runs (job, status, detail)
        values ('cbs-index', 'ok', '{"secret": "not shown"}');
      insert into public.identifier_candidates (supplier_id, scheme, value, source, searched_name)
        values ('${SUPPLIER}', 'company', '512345679', 'companies_registrar', 'ספק');
      insert into public.import_batches (script_name, row_count, note)
        values ('pool_file_registries.py', 2, 'הערה חופשית')`);
  });
  after(async () => {
    await db.close();
  });

  it('is read by an admin and an auditor only', async () => {
    for (const user of [USERS.editor, USERS.manager, USERS.viewer, USERS.pending]) {
      assert.equal(await errorCode(control(db, user)), '42501');
    }
    assert.ok(await control(db, USERS.auditor));
  });

  it('reports counts and statuses without details, notes or numbers', async () => {
    const value = await control(db, USERS.admin);
    assert.ok(value);
    assert.deepEqual(Object.keys(value.jobs[0] ?? {}).sort(), [
      'finished_at',
      'job',
      'started_at',
      'status',
    ]);
    assert.equal(value.batches[0]?.row_count, 2);
    assert.deepEqual(value.registries[0], {
      name: 'מאגר',
      status: 'active',
      memberships: 1,
      needs_review: 1,
      verified: 0,
    });
    assert.deepEqual(value.candidates, { companies_registrar: 1 });
    assert.equal(value.identifiers_pending, 2);
    assert.equal(value.same_names, 1);
    assert.equal(value.venues, 0);
    const text = JSON.stringify(value);
    for (const hidden of ['not shown', 'הערה חופשית', '512345678', '512345679', '012345678']) {
      assert.ok(!text.includes(hidden), hidden);
    }
  });
});

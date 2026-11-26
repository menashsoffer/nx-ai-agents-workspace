// Registry results for supplier edits (supplier-edit-checks-spec-he.md, 6.3, stage 2).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';
import { CHANGE_FIXTURE, VERIFIED, checkChange, failure } from './supplier-change-fixture.ts';

interface Input {
  identifiers: { id: string; scheme: string; value: string }[];
}

interface Result {
  id: string;
  found: boolean;
  name?: string;
  status?: string;
  details?: unknown;
}

async function input(db: PGlite, user: string | null, target = SUPPLIER): Promise<Input> {
  return as(db, user, async () => {
    const { rows } = await db.query<{ v: Input }>('select public.registry_check_input($1) as v', [
      target,
    ]);
    if (!rows[0]) throw new Error('No answer');
    return rows[0].v;
  });
}

async function save(db: PGlite, target: string, results: Result[]): Promise<number> {
  await db.exec('set role service_role');
  try {
    const { rows } = await db.query<{ v: number }>(
      'select public.save_registry_checks($1, $2) as v',
      [target, JSON.stringify(results)],
    );
    return rows[0]?.v ?? 0;
  } finally {
    await db.exec('reset role');
  }
}

async function identifierOf(db: PGlite, target: string) {
  const { rows } = await db.query<{
    id: string;
    registrar_name: string | null;
    registrar_status: string | null;
    registry_details: unknown;
    checked: boolean;
  }>(
    `select id, registrar_name, registrar_status, registry_details, checked_at is not null as checked
     from public.supplier_identifiers where supplier_id = $1 and scheme = 'company'`,
    [target],
  );
  if (!rows[0]) throw new Error('No identifier');
  return rows[0];
}

async function reviewOf(db: PGlite, target: string): Promise<string | undefined> {
  const { rows } = await db.query<{ review_status: string }>(
    'select review_status from public.suppliers where id = $1',
    [target],
  );
  return rows[0]?.review_status;
}

describe('registry checks', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(CHANGE_FIXTURE);
  });
  after(async () => db.close());

  it('lists only unchecked company and nonprofit numbers, to editors only', async () => {
    const listed = await input(db, USERS.editor);
    assert.deepEqual(
      listed.identifiers.map((i) => [i.scheme, i.value]),
      [['company', '512345678']],
    );
    assert.match(await failure(input(db, null)), /42501/u);
    assert.match(await failure(input(db, USERS.viewer)), /PT403/u);
    assert.match(
      await failure(input(db, USERS.editor, '49999999-0000-0000-0000-000000000000')),
      /PT404/u,
    );
  });

  it('keeps registry columns away from signed-in users and saving away from them', async () => {
    const { id } = await identifierOf(db, SUPPLIER);
    const forged = as(db, USERS.editor, () =>
      db.query("update public.supplier_identifiers set registrar_name = 'מזויף' where id = $1", [
        id,
      ]),
    );
    assert.match(await failure(forged), /42501/u);
    const direct = as(db, USERS.editor, () =>
      db.query('select public.save_registry_checks($1, $2)', [SUPPLIER, '[]']),
    );
    assert.match(await failure(direct), /42501/u);
  });

  it('stores what the registry said and does not ask again for a day', async () => {
    const { id } = await identifierOf(db, SUPPLIER);
    const details = { corporation_type: 'חברה פרטית' };
    assert.equal(
      await save(db, SUPPLIER, [{ id, found: true, name: 'ספק בע"מ', status: 'פעילה', details }]),
      1,
    );
    const stored = await identifierOf(db, SUPPLIER);
    assert.equal(stored.registrar_name, 'ספק בע"מ');
    assert.equal(stored.registrar_status, 'פעילה');
    assert.deepEqual(stored.registry_details, details);
    assert.equal(stored.checked, true);
    assert.deepEqual((await input(db, USERS.editor)).identifiers, []);
    const rename = await as(db, USERS.editor, () =>
      checkChange(db, { supplier_id: SUPPLIER, kind: 'rename', value: 'ספקים' }),
    );
    assert.deepEqual(
      rename.checks.find((c) => c.check === 'registry_status'),
      { check: 'registry_status', outcome: 'green', name: 'פעילה' },
    );
  });

  it('ignores numbers of another supplier', async () => {
    const { id } = await identifierOf(db, VERIFIED);
    assert.equal(await save(db, SUPPLIER, [{ id, found: false }]), 0);
    assert.equal((await identifierOf(db, VERIFIED)).registrar_status, null);
  });

  it('warns and marks the supplier for review when the body is gone', async () => {
    const { id } = await identifierOf(db, VERIFIED);
    await db.exec(
      `update public.suppliers set review_status = 'verified' where id = '${VERIFIED}'`,
    );
    await save(db, VERIFIED, [
      { id, found: true, name: 'חברת הנדסה ירושלמית בע"מ', status: 'מחוקה' },
    ]);
    assert.equal(await reviewOf(db, VERIFIED), 'needs_review');
    const kind = await as(db, USERS.editor, () =>
      checkChange(db, { supplier_id: VERIFIED, kind: 'entity_kind', value: 'public_body' }),
    );
    assert.deepEqual(
      kind.checks.find((c) => c.check === 'registry_status'),
      { check: 'registry_status', outcome: 'yellow', name: 'מחוקה' },
    );
    // A person verified it again on purpose: the same answer does not undo that.
    await db.exec(
      `update public.suppliers set review_status = 'verified' where id = '${VERIFIED}'`,
    );
    await save(db, VERIFIED, [{ id, found: true, status: 'מחוקה' }]);
    assert.equal(await reviewOf(db, VERIFIED), 'verified');
  });

  it('records a number the registry does not know', async () => {
    const { id } = await identifierOf(db, SUPPLIER);
    await save(db, SUPPLIER, [{ id, found: false }]);
    const stored = await identifierOf(db, SUPPLIER);
    assert.equal(stored.registrar_status, 'לא נמצא במרשם');
    assert.equal(stored.registrar_name, 'ספק בע"מ');
  });
});

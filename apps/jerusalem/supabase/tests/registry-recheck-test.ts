// The monthly registry re-check (supplier-edit-checks-spec-he.md, 6.7, stage 5).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';
import { CHANGE_FIXTURE, VERIFIED, failure } from './supplier-change-fixture.ts';

interface Queued {
  id: string;
  supplier_id: string;
  scheme: string;
  value: string;
}

async function asService<T>(db: PGlite, sql: string, args: unknown[]): Promise<T | undefined> {
  await db.exec('set role service_role');
  try {
    const { rows } = await db.query<{ v: T }>(sql, args);
    return rows[0]?.v;
  } finally {
    await db.exec('reset role');
  }
}

const queue = (db: PGlite) =>
  asService<Queued[]>(db, 'select public.registry_recheck_queue(50) as v', []).then((v) => v ?? []);
const save = (db: PGlite, results: unknown[]) =>
  asService<number>(db, 'select public.save_registry_rechecks($1) as v', [JSON.stringify(results)]);

describe('registry re-check', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(CHANGE_FIXTURE);
  });
  after(async () => db.close());

  it('queues only verified company and nonprofit numbers', async () => {
    const queued = await queue(db);
    assert.deepEqual(
      queued.map((q) => [q.supplier_id, q.value]),
      [[VERIFIED, '513000001']],
      'the pending numbers of SUPPLIER wait for a person, not for the re-check',
    );
  });

  it('marks a supplier whose body is gone and waits 30 days before asking again', async () => {
    const [item] = await queue(db);
    if (!item) throw new Error('Nothing queued');
    await db.exec(
      `update public.suppliers set review_status = 'verified' where id = '${VERIFIED}'`,
    );
    const checks = { checks: { registrar: 'ok', events: 'ok' } };
    const answer = { id: item.id, found: true, status: 'בפירוק', details: checks };
    const remaining = await save(db, [answer]);
    assert.equal(remaining, 0);
    assert.deepEqual(await queue(db), []);
    const { rows } = await db.query<{ review_status: string }>(
      'select review_status from public.suppliers where id = $1',
      [VERIFIED],
    );
    assert.equal(rows[0]?.review_status, 'needs_review');
    await db.exec(
      `update public.supplier_identifiers set checked_at = now() - interval '31 days'
       where id = '${item.id}'`,
    );
    assert.equal((await queue(db)).length, 1);
  });

  it('asks at once about an approved number whose last answer predates the new checks', async () => {
    await db.exec(
      `update public.supplier_identifiers set checked_at = now(), registry_details = '{}'
       where supplier_id = '${VERIFIED}'`,
    );
    assert.deepEqual(
      (await queue(db)).map((q) => q.value),
      ['513000001'],
    );
  });

  it('is for the scheduled function only', async () => {
    const call = as(db, USERS.admin, () => db.query('select public.registry_recheck_queue(5)'));
    assert.match(await failure(call), /42501/u);
    const write = as(db, USERS.admin, () =>
      db.query('select public.save_registry_rechecks($1)', [JSON.stringify([{ id: SUPPLIER }])]),
    );
    assert.match(await failure(write), /42501/u);
  });
});

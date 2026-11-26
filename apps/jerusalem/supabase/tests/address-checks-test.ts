import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

const PERSON = '40000000-0000-0000-0000-000000000002';
const ADDRESS = '50000000-0000-0000-0000-000000000001';
const SECOND = '50000000-0000-0000-0000-000000000002';
const PRIVATE = '50000000-0000-0000-0000-000000000003';

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function asService<T>(db: PGlite, action: () => Promise<T>): Promise<T> {
  await db.exec('set role service_role');
  try {
    return await action();
  } finally {
    await db.exec('reset role');
  }
}

async function queue(db: PGlite): Promise<string[]> {
  return asService(db, async () => {
    const rows = await db.query<{ contact_id: string }>(
      'select contact_id from public.address_check_queue(10)',
    );
    return rows.rows.map((row) => row.contact_id);
  });
}

async function save(db: PGlite, results: unknown[]): Promise<number> {
  return asService(db, async () => {
    const rows = await db.query<{ left: number }>(
      'select public.save_address_checks($1::jsonb) as left',
      [JSON.stringify(results)],
    );
    return rows.rows[0]?.left ?? Number.NaN;
  });
}

interface Listed {
  counts: Record<string, number>;
  items: { contact_id: string; result: string }[];
}

async function listed(db: PGlite, user: string): Promise<Listed> {
  return as(db, user, async () => {
    const rows = await db.query<{ value: Listed }>('select public.addresses_to_check() as value');
    const value = rows.rows[0]?.value;
    if (!value) throw new Error('No answer');
    return value;
  });
}

async function detailMap(db: PGlite, contact: string): Promise<unknown> {
  return as(db, USERS.viewer, async () => {
    const rows = await db.query<{ value: { contacts: { id: string; map: unknown }[] } }>(
      'select public.supplier_detail($1) as value',
      [SUPPLIER],
    );
    return rows.rows[0]?.value.contacts.find((item) => item.id === contact)?.map;
  });
}

describe('address checks', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`
      insert into public.suppliers (id, display_name, entity_kind)
        values ('${PERSON}', 'אדם פרטי', 'sole_trader');
      insert into public.supplier_contacts (id, supplier_id, kind, value) values
        ('${ADDRESS}', '${SUPPLIER}', 'address', 'יפו 216, ירושלים'),
        ('${SECOND}', '${SUPPLIER}', 'address', 'אין רחוב כזה 9, ירושלים'),
        ('${PRIVATE}', '${PERSON}', 'address', 'הרצל 1, ירושלים')`);
  });
  after(async () => db.close());

  it('queues company addresses but never a private person', async () => {
    const waiting = await queue(db);
    assert.deepEqual([...waiting].sort(), [ADDRESS, SECOND]);
  });

  it('keeps the queue and answers away from signed-in users', async () => {
    const code = await as(db, USERS.admin, () =>
      errorCode(db.query('select * from public.address_check_queue(5)')),
    );
    assert.equal(code, '42501');
  });

  it('saves answers, ignores stale ones and counts what still waits', async () => {
    const left = await save(db, [
      {
        contact_id: ADDRESS,
        value: 'יפו 216, ירושלים',
        result: 'found',
        map_label: 'יפו 216',
        latitude: 31.789,
        longitude: 35.203,
      },
      { contact_id: SECOND, value: 'טקסט ישן', result: 'found', map_label: null },
    ]);
    assert.equal(left, 1);
    assert.deepEqual(await queue(db), [SECOND]);
    assert.deepEqual(await detailMap(db, ADDRESS), { result: 'found', label: 'יפו 216' });
  });

  it('rejects a body that is not a list', async () => {
    const code = await errorCode(save(db, { not: 'a list' } as unknown as unknown[]));
    assert.equal(code, '22023');
  });

  it('lists unfound addresses for an admin only', async () => {
    await save(db, [{ contact_id: SECOND, value: 'אין רחוב כזה 9, ירושלים', result: 'not_found' }]);
    const answer = await listed(db, USERS.admin);
    assert.deepEqual(
      answer.items.map((item) => item.contact_id),
      [SECOND],
    );
    assert.equal(answer.counts.found, 1);
    assert.equal(answer.counts.not_found, 1);
    const code = await errorCode(listed(db, USERS.viewer));
    assert.equal(code, '42501');
  });

  it('lets members read the answers, and nobody sign in and write them', async () => {
    const read = (user: string | null) =>
      as(db, user, () => count(db, 'select 1 from public.address_checks'));
    assert.equal(await read(USERS.viewer), 2);
    assert.equal(await read(USERS.auditor), 2);
    assert.equal(await read(USERS.pending), 0);
    assert.equal(await read(USERS.blocked), 0);
    assert.equal(await errorCode(read(null)), '42501');
    const write = (sql: string) => as(db, USERS.admin, () => errorCode(db.query(sql)));
    assert.equal(
      await write(`insert into public.address_checks (contact_id, checked_value, result)
        values ('${PRIVATE}', 'x', 'found')`),
      '42501',
    );
    assert.equal(await write("update public.address_checks set result = 'found'"), '42501');
    assert.equal(await write('delete from public.address_checks'), '42501');
  });

  it('checks an address again once its text changes', async () => {
    await db.exec(`update public.supplier_contacts set value = 'יפו 218, ירושלים'
      where id = '${ADDRESS}'`);
    assert.deepEqual(await queue(db), [ADDRESS]);
    assert.equal(await detailMap(db, ADDRESS), null);
  });
});

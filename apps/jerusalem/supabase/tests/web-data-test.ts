import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { parseAccess, mayWriteUnit } from '../../web/src/data/access.ts';
import { object } from '../../web/src/data/parse.ts';
import { DataClient } from '../../web/src/data/client.ts';
import { ACCESS_FIXTURE, UNIT_1, UNIT_2, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

function clientFor(db: PGlite, user: string): DataClient {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('/rpc/catalog_snapshot')) {
      const result = await db.query<{ value: unknown }>(
        'select public.catalog_snapshot() as value',
      );
      return Response.json(result.rows[0]?.value);
    }
    const table = url.pathname.split('/').at(-1);
    if (table !== 'profiles' && table !== 'role_grants') return new Response('', { status: 404 });
    assert.equal(url.searchParams.get('user_id'), `eq.${user}`);
    const query = `select * from public.${table} where user_id = $1::uuid`;
    const result = await db.query(query, [user]);
    return Response.json(result.rows);
  };
  return new DataClient({
    baseUrl: 'https://test.invalid',
    publicKey: 'test',
    token: 'test',
    fetcher,
  });
}

describe('website access against the migrated database', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('gives a pending user a waiting state and no write permission', async () => {
    await as(db, USERS.pending, async () => {
      const access = parseAccess(
        object(await clientFor(db, USERS.pending).rpc('catalog_snapshot', {})).access,
      );
      assert.equal(access.state, 'pending');
      assert.equal(access.member, false);
      assert.equal(mayWriteUnit(access, UNIT_1), false);
    });
  });

  it('limits an editor to the assigned unit and keeps viewers read-only', async () => {
    await as(db, USERS.editor, async () => {
      const access = parseAccess(
        object(await clientFor(db, USERS.editor).rpc('catalog_snapshot', {})).access,
      );
      assert.equal(mayWriteUnit(access, UNIT_1), true);
      assert.equal(mayWriteUnit(access, UNIT_2), false);
    });
    await as(db, USERS.viewer, async () => {
      const access = parseAccess(
        object(await clientFor(db, USERS.viewer).rpc('catalog_snapshot', {})).access,
      );
      assert.equal(access.member, true);
      assert.equal(mayWriteUnit(access, UNIT_1), false);
    });
  });

  it('treats the auditor as read-only and admin as administrator', async () => {
    for (const user of [USERS.auditor, USERS.admin]) {
      await as(db, user, async () => {
        const access = parseAccess(
          object(await clientFor(db, user).rpc('catalog_snapshot', {})).access,
        );
        assert.equal(access.member, true);
        assert.equal(access.admin, user === USERS.admin);
        assert.equal(mayWriteUnit(access, UNIT_1), user === USERS.admin);
      });
    }
  });
});

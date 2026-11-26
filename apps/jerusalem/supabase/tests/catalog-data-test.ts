import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { buildCatalog } from '../../web/src/catalog-model.ts';
import { compactCatalog } from '../../web/src/data/compact-catalog.ts';
import { object } from '../../web/src/data/parse.ts';
import { supplierDetail } from '../../web/src/data/supplier-detail.ts';
import { DataClient } from '../../web/src/data/client.ts';
import { ACCESS_FIXTURE, SUPPLIER, USERS, VERSION } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

function clientFor(db: PGlite): DataClient {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const name = url.pathname.split('/').at(-1);
    if (name !== 'catalog_snapshot' && name !== 'supplier_detail')
      return new Response(null, { status: 404 });
    if (typeof init?.body !== 'string') throw new Error('Missing request body');
    const args = object(JSON.parse(init.body) as unknown);
    const arg = name === 'catalog_snapshot' ? null : args.supplier_id;
    const result = await db.query<{ value: unknown }>(`select public.${name}($1) as value`, [arg]);
    return Response.json(result.rows[0]?.value);
  };
  return new DataClient({
    baseUrl: 'https://test.invalid',
    publicKey: 'test',
    token: 'test',
    fetcher,
  });
}

describe('new catalog respects database visibility', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.memberships (supplier_id, registry_version_id, review_status)
      values ('${SUPPLIER}', '${VERSION}', 'needs_review')`);
  });
  after(async () => {
    await db.close();
  });

  it('shows the membership to its editor but not to a viewer until verified', async () => {
    for (const [user, expected] of [
      [USERS.editor, 1],
      [USERS.viewer, 0],
    ] as const) {
      await as(db, user, async () => {
        const rows = buildCatalog(
          compactCatalog(object(await clientFor(db).rpc('catalog_snapshot', {})).catalog),
        );
        assert.equal(rows.length, expected);
        if (expected) assert.equal(rows[0]?.memberships.length, 1);
      });
    }
  });

  it('keeps contact values out of the catalog and shows current ones in details', async () => {
    await db.exec(`insert into public.supplier_contacts (supplier_id, kind, value, status) values
      ('${SUPPLIER}', 'phone', '0501111111', 'outdated'),
      ('${SUPPLIER}', 'phone', '0502222222', 'current'),
      ('${SUPPLIER}', 'email', 'disputed@example.test', 'disputed')`);
    await as(db, USERS.editor, async () => {
      const client = clientFor(db);
      const cached = compactCatalog(object(await client.rpc('catalog_snapshot', {})).catalog);
      // The catalog carries only the kinds; values come with the supplier's details.
      assert.deepEqual(buildCatalog(cached)[0]?.contactKinds, ['phone']);
      assert.equal(JSON.stringify(cached).includes('0502222222'), false);
      const detail = await supplierDetail(client, cached, SUPPLIER);
      assert.deepEqual(
        detail.contacts.map((contact) => contact.value),
        ['0502222222'],
      );
    });
  });

  it('returns a personal ID number in details to editors but never to a viewer', async () => {
    for (const [user, expected] of [
      [USERS.viewer, ['company']],
      [USERS.editor, ['company', 'personal_id']],
    ] as const) {
      await as(db, user, async () => {
        const result = await db.query<{ value: { identifiers: { scheme: string }[] } }>(
          'select public.supplier_detail($1) as value',
          [SUPPLIER],
        );
        const schemes = result.rows[0]?.value.identifiers.map((row) => row.scheme).sort();
        assert.deepEqual(schemes, expected);
      });
    }
  });
});

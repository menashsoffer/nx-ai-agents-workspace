import assert from 'node:assert/strict';
import { it, mock } from 'node:test';

import * as site from '../src/data/site.ts';
import type { CatalogState } from '../src/data/snapshot.ts';
import { requestUrl, response, SUPPLIER, TOKEN } from './catalog-fixture.ts';

it('clears current state on any current-session 401 and ignores unauthorized stale sessions', async () => {
  const fetcher: typeof fetch = (input) =>
    Promise.resolve(
      requestUrl(input).endsWith('/catalog_snapshot')
        ? Response.json(response())
        : new Response(null, { status: 401 }),
    );
  const spy = mock.method(globalThis, 'fetch', fetcher);
  await site.clearCatalog();
  const published: (CatalogState | null)[] = [];
  const unsubscribe = site.subscribe((state) => published.push(state));
  try {
    await site.loadSnapshot(TOKEN);
    assert.equal(site.getAccess()?.member, true);
    await assert.rejects(site.data('older-session').list('suppliers'));
    assert.equal(site.getAccess()?.member, true);
    assert.equal(published.filter((state) => state === null).length, 0);
    await assert.rejects(site.detail(TOKEN, SUPPLIER));
    assert.equal(site.getAccess(), null);
    assert.equal(published.filter((state) => state === null).length, 1);
  } finally {
    unsubscribe();
    spy.mock.restore();
    await site.clearCatalog();
  }
});

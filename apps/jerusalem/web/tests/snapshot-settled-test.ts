import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SnapshotLoader, type CatalogState } from '../src/data/snapshot.ts';
import * as site from '../src/data/site.ts';
import { access, client, deferred, response, TOKEN } from './catalog-fixture.ts';
import type { CacheEntry } from '../src/data/catalog-cache.ts';

function memoryCache(entry: CacheEntry | null) {
  return {
    read: () => Promise.resolve(entry),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
}

describe('server-confirmed catalog state', () => {
  it('waits for a pending revalidation instead of reporting a cached catalog without access', async () => {
    const wire = response();
    const loader = new SnapshotLoader(memoryCache({ version: '1:roles', catalog: wire.catalog }));
    const reply = deferred<Response>();
    const shown: CatalogState[] = [];
    const loading = loader.load(
      client(() => reply.promise),
      TOKEN,
      { publish: (state) => shown.push(state) },
    );
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(shown[0]?.access, null, 'the cached catalog is shown before access arrives');
    const settled = loader.settled();
    reply.resolve(Response.json(response({ unchanged: true, catalog: undefined })));
    const state = await settled;
    assert.ok(state);
    assert.equal(state.access?.member, true);
    assert.ok(state.catalog, 'the confirmed state keeps the catalog');
    await loading;
  });

  it('reports no state when the refresh fails or shows the user is not a member', async () => {
    const failed = new SnapshotLoader(memoryCache(null));
    const loading = failed.load(
      client(() => new Response(null, { status: 500 })),
      TOKEN,
    );
    assert.equal(await failed.settled(), null);
    await assert.rejects(loading);
    const pending = new SnapshotLoader(memoryCache(null));
    await pending.load(
      client(() =>
        Response.json(response({ access: { ...access(), state: 'pending', member: false } })),
      ),
      TOKEN,
    );
    const state = await pending.settled();
    assert.equal(state?.catalog ?? null, null);
  });

  it('clears silently for a sign-out that reloads the page', async () => {
    const published: (CatalogState | null)[] = [];
    const unsubscribe = site.subscribe((state) => published.push(state));
    try {
      await site.clearCatalog(undefined, false);
      assert.deepEqual(published, []);
      await site.clearCatalog();
      assert.deepEqual(published, [null]);
    } finally {
      unsubscribe();
    }
  });
});

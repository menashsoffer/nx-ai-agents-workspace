import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { IndexedCatalogCache } from '../src/data/catalog-cache.ts';
import { SnapshotLoader, type CatalogState } from '../src/data/snapshot.ts';
import {
  access,
  requestBody,
  requestUrl,
  client,
  deferred,
  OTHER_USER,
  response,
  TOKEN,
  USER,
  wireCatalog,
} from './catalog-fixture.ts';

function cache() {
  return new IndexedCatalogCache('test', () => newFactory);
}
let newFactory = new IDBFactory();

describe('versioned IndexedDB catalog cache', () => {
  it('misses once, then shows the cached catalog before an unchanged response arrives', async () => {
    newFactory = new IDBFactory();
    const storage = cache();
    const states: CatalogState[] = [];
    const loader = new SnapshotLoader(storage);
    let requests = 0;
    const api = client((url, init) => {
      requests++;
      assert.match(requestUrl(url), /rpc\/catalog_snapshot$/);
      assert.deepEqual(requestBody(init), { known_version: null });
      return Response.json(response());
    });
    await loader.load(api, TOKEN, { publish: (state) => states.push(state) });
    assert.equal(requests, 1);
    assert.deepEqual(
      states.map((state) => state.refreshing),
      [false],
    );
    assert.equal((await storage.read(USER))?.version, '1:roles');
    const pending = deferred<Response>();
    const started = deferred<undefined>();
    const again = new SnapshotLoader(storage);
    const fresh: CatalogState[] = [];
    const loading = again.load(
      client((_url, init) => {
        assert.deepEqual(requestBody(init), { known_version: '1:roles' });
        started.resolve(undefined);
        return pending.promise;
      }),
      TOKEN,
      { publish: (state) => fresh.push(state) },
    );
    await started.promise;
    assert.equal(fresh.length, 1);
    assert.ok(fresh[0]);
    assert.equal(fresh[0].refreshing, true);
    assert.equal(fresh[0].access, null, 'cached data never grants editing permission');
    assert.equal(fresh[0].suppliers[0]?.name, 'שם נוכחי');
    pending.resolve(Response.json(response({ unchanged: true, catalog: undefined })));
    await loading;
    assert.ok(fresh[1]);
    assert.equal(fresh[1].refreshing, false);
    assert.equal(fresh[1].suppliers, fresh[0].suppliers, 'unchanged reuses the model');
    assert.equal(fresh[1].access?.member, true);
    const reused = await again.load(
      client(() => Response.json(response({ unchanged: true, catalog: undefined }))),
      TOKEN,
    );
    assert.equal(reused.timings.model_ms, '0');
  });

  it('partitions by user, replaces changed data, and revalidates using the in-memory version', async () => {
    newFactory = new IDBFactory();
    const storage = cache();
    await storage.write(OTHER_USER, { version: 'other', catalog: wireCatalog() });
    const loader = new SnapshotLoader(storage);
    const api = client((_url, init) => {
      assert.deepEqual(requestBody(init), { known_version: null });
      return Response.json(response({ version: '2:new' }));
    });
    await loader.load(api, TOKEN);
    await loader.load(
      client((_url, init) => {
        assert.deepEqual(requestBody(init), { known_version: '2:new' });
        return Response.json(response({ version: '3:newer' }));
      }),
      TOKEN,
    );
    assert.equal((await storage.read(USER))?.version, '3:newer');
    assert.equal((await storage.read(OTHER_USER))?.version, 'other');
  });

  for (const reason of ['sign-out', 'blocked', '401'] as const) {
    it(`deletes the user's disk and memory cache on ${reason}`, async () => {
      newFactory = new IDBFactory();
      const storage = cache();
      const loader = new SnapshotLoader(storage);
      await loader.load(
        client(() => Response.json(response())),
        TOKEN,
      );
      if (reason === 'sign-out') await loader.clear();
      else if (reason === 'blocked') {
        const state = await loader.load(
          client(() =>
            Response.json(
              response({
                access: access({ state: 'blocked', member: false }),
                catalog: undefined,
              }),
            ),
          ),
          TOKEN,
        );
        assert.deepEqual(state.suppliers, []);
        assert.equal(state.catalog, null);
      } else {
        await assert.rejects(
          loader.load(
            client(() => new Response(null, { status: 401 })),
            TOKEN,
          ),
        );
        assert.equal(loader.state, null);
      }
      assert.equal(await storage.read(USER), null);
      assert.equal(loader.state?.catalog ?? null, null);
    });
  }

  it('loads without storage when IndexedDB is blocked or throws on access', async () => {
    const blocked = new IndexedCatalogCache('blocked', () => {
      throw new Error('denied');
    });
    const state = await new SnapshotLoader(blocked).load(
      client(() => Response.json(response())),
      TOKEN,
    );
    assert.equal(state.suppliers.length, 1);
    assert.equal(await blocked.read(USER), null);
    await blocked.write(USER, { version: 'x', catalog: {} });
    await blocked.remove(USER);
  });

  it('discards malformed cached data and rejects unchanged without a valid cache', async () => {
    newFactory = new IDBFactory();
    const storage = cache();
    await storage.write(USER, { version: 'bad', catalog: { suppliers: [] } });
    const state = await new SnapshotLoader(storage).load(
      client((_url, init) => {
        assert.deepEqual(requestBody(init), { known_version: null });
        return Response.json(response());
      }),
      TOKEN,
    );
    assert.equal(state.suppliers.length, 1);
    await storage.remove(USER);
    await assert.rejects(
      new SnapshotLoader(storage).load(
        client(() => Response.json(response({ unchanged: true, catalog: undefined }))),
        TOKEN,
      ),
    );
  });

  it('does not restore data or publish a response that finishes after sign-out', async () => {
    newFactory = new IDBFactory();
    const storage = cache();
    const loader = new SnapshotLoader(storage);
    const pending = deferred<Response>();
    const started = deferred<undefined>();
    const published: CatalogState[] = [];
    const loading = loader.load(
      client(() => {
        started.resolve(undefined);
        return pending.promise;
      }),
      TOKEN,
      { publish: (state) => published.push(state) },
    );
    await started.promise;
    await loader.clear(USER);
    pending.resolve(Response.json(response()));
    await assert.rejects(loading);
    assert.equal(published.length, 0);
    assert.equal(loader.state, null);
    assert.equal(await storage.read(USER), null);
  });

  it('clears the cache if the server user does not match the token cache partition', async () => {
    newFactory = new IDBFactory();
    const storage = cache();
    await storage.write(USER, { version: 'old', catalog: wireCatalog() });
    await assert.rejects(
      new SnapshotLoader(storage).load(
        client(() => Response.json(response({ user_id: OTHER_USER }))),
        TOKEN,
      ),
    );
    assert.equal(await storage.read(USER), null);
    assert.equal(await storage.read(OTHER_USER), null);
  });

  it('does not return a completed model if sign-out occurs while its cache write is pending', async () => {
    const writing = deferred<undefined>();
    const started = deferred<undefined>();
    let stored: unknown = null;
    const storage = {
      read: () => Promise.resolve(null),
      write: async (_id: string, entry: unknown) => {
        started.resolve(undefined);
        await writing.promise;
        stored = entry;
      },
      remove: () => {
        stored = null;
        return Promise.resolve();
      },
    };
    const loader = new SnapshotLoader(storage);
    const loading = loader.load(
      client(() => Response.json(response())),
      TOKEN,
    );
    await started.promise;
    const leaving = loader.clear(USER);
    writing.resolve(undefined);
    await assert.rejects(loading);
    await leaving;
    assert.equal(loader.state, null);
    assert.equal(stored, null);
  });
});

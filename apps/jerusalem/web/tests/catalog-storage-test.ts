// IndexedCatalogCache on its own: failures of the browser storage never reach the caller.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { IndexedCatalogCache } from '../src/data/catalog-cache.ts';

interface FakeOpen {
  result?: { close: () => void };
  onupgradeneeded?: () => void;
  onerror?: () => void;
  onsuccess?: () => void;
}

/** An IndexedDB factory whose open request is settled by the test. */
function manual() {
  const opens: FakeOpen[] = [];
  const factory = {
    open: () => {
      const pending: FakeOpen = {};
      opens.push(pending);
      return pending;
    },
  } as unknown as IDBFactory;
  return { factory, opens };
}

describe('IndexedCatalogCache', () => {
  it('stores, reads and removes an entry per user', async () => {
    const factory = new IDBFactory();
    const cache = new IndexedCatalogCache('a', () => factory);
    assert.equal(await cache.read('u1'), null);
    await cache.write('u1', { version: '1', catalog: { x: 1 } });
    assert.deepEqual(await cache.read('u1'), { version: '1', catalog: { x: 1 } });
    assert.equal(await cache.read('u2'), null);
    await cache.remove('u1');
    assert.equal(await cache.read('u1'), null);
  });

  it('ignores a stored value without a version', async () => {
    const factory = new IDBFactory();
    const cache = new IndexedCatalogCache('b', () => factory);
    await cache.write('u1', { version: 1, catalog: null } as never);
    assert.equal(await cache.read('u1'), null);
  });

  it('gives up on an open that errors', async () => {
    const { factory, opens } = manual();
    const cache = new IndexedCatalogCache('c', () => factory);
    const reading = cache.read('u1');
    opens[0]?.onerror?.();
    assert.equal(await reading, null);
    const writing = cache.write('u1', { version: '1', catalog: null });
    opens[1]?.onerror?.();
    await writing;
    const removing = cache.remove('u1');
    opens[2]?.onerror?.();
    await removing;
  });

  it('times out a blocked open and closes it if it succeeds later', async () => {
    const { factory, opens } = manual();
    const cache = new IndexedCatalogCache('d', () => factory);
    assert.equal(await cache.read('u1'), null);
    let closed = false;
    const pending = opens[0];
    assert.ok(pending);
    pending.result = {
      close: () => {
        closed = true;
      },
    };
    pending.onsuccess?.();
    assert.equal(closed, true);
  });

  it('treats a failed storage request as a miss', async () => {
    const factory = new IDBFactory();
    const cache = new IndexedCatalogCache('e', () => factory);
    await cache.write('u1', { version: '1', catalog: () => undefined });
    assert.equal(await cache.read('u1'), null);
  });
});

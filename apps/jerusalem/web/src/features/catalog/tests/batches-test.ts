import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBatches } from '../model/batches.ts';
describe('progressive catalog rendering', () => {
  it('publishes batches of 100 and stops a stale continuation after unmount', async () => {
    const tasks: (() => void)[] = [];
    const store = createBatches(
      533,
      () =>
        new Promise<void>((resolve) => {
          tasks.push(resolve);
        }),
    );
    const counts: number[] = [];
    store.subscribe(() => {
      counts.push(store.getSnapshot());
    });
    const stop = store.mount();
    assert.equal(store.getSnapshot(), 100);
    tasks.shift()?.();
    await Promise.resolve();
    assert.equal(store.getSnapshot(), 200);
    stop();
    tasks.shift()?.();
    await Promise.resolve();
    assert.equal(store.getSnapshot(), 200);
    assert.deepEqual(counts, [200]);
  });
  it('reaches the exact result count and does not notify removed subscribers', async () => {
    const tasks: (() => void)[] = [];
    const store = createBatches(
      250,
      () =>
        new Promise<void>((resolve) => {
          tasks.push(resolve);
        }),
    );
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications++;
    });
    const stop = store.mount();
    tasks.shift()?.();
    await Promise.resolve();
    unsubscribe();
    tasks.shift()?.();
    await Promise.resolve();
    assert.equal(store.getSnapshot(), 250);
    assert.equal(notifications, 1);
    stop();
  });
  it('does not let an old draw replace newer empty results', async () => {
    let resume: () => void = () => undefined;
    const old = createBatches(
      200,
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    );
    const stop = old.mount();
    stop();
    const current = createBatches(0);
    const clear = current.mount();
    resume();
    await Promise.resolve();
    assert.equal(current.getSnapshot(), 0);
    assert.equal(old.getSnapshot(), 100);
    clear();
  });
});

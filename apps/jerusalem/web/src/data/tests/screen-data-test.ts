import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  MAX_AGE_MS,
  clearScreenData,
  getScreenData,
  invalidate,
  snapshotOf,
  watch,
} from '../screen-data.ts';

const KEY = ['engagement', 'saved'] as const;

function counter(values: unknown[]) {
  let calls = 0;
  const fetcher = () => {
    const value = values[Math.min(calls, values.length - 1)];
    calls += 1;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  return { fetcher, calls: () => calls };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  clearScreenData();
  mock.timers.reset();
});

describe('screen data', () => {
  it('answers a second visit from memory while the value is fresh', async () => {
    const load = counter(['a', 'b']);
    assert.equal(await getScreenData(KEY, load.fetcher), 'a');
    assert.equal(await getScreenData(KEY, load.fetcher), 'a');
    assert.equal(load.calls(), 1);
  });

  it('shows an old value at once and loads a new one behind it', async () => {
    mock.timers.enable({ apis: ['Date'], now: 0 });
    const load = counter(['a', 'b']);
    await getScreenData(KEY, load.fetcher);
    mock.timers.tick(MAX_AGE_MS + 1);
    assert.equal(await getScreenData(KEY, load.fetcher), 'a');
    await tick();
    assert.equal(snapshotOf(KEY)?.value, 'b');
  });

  it('reloads a shown key on invalidate, by prefix, and tells the screen', async () => {
    const load = counter(['a', 'b']);
    await getScreenData(KEY, load.fetcher);
    let told = 0;
    const stop = watch(KEY, () => (told += 1));
    await invalidate(['engagement']);
    assert.equal(snapshotOf(KEY)?.value, 'b');
    assert.equal(told, 1);
    await invalidate(['engagements']);
    assert.equal(load.calls(), 2);
    stop();
  });

  it('only marks a key nobody shows, and loads it on the next visit', async () => {
    const load = counter(['a', 'b']);
    await getScreenData(KEY, load.fetcher);
    await invalidate(KEY);
    assert.equal(load.calls(), 1);
    // Stale: the old value shows at once while the new one loads.
    assert.equal(await getScreenData(KEY, load.fetcher), 'a');
    await tick();
    assert.equal(load.calls(), 2);
  });

  it('keeps the shown value and marks it failed when a reload fails', async () => {
    const load = counter(['a', new Error('down')]);
    await getScreenData(KEY, load.fetcher);
    const stop = watch(KEY, () => undefined);
    await invalidate(KEY);
    assert.deepEqual(snapshotOf(KEY), { value: 'a', failed: true });
    stop();
  });

  it('throws on a first load that fails, so the screen shows its error', async () => {
    await assert.rejects(getScreenData(KEY, counter([new Error('down')]).fetcher));
  });

  it('seeds a key from a screen whose loader did not run here', async () => {
    const load = counter(['b']);
    const stop = watch(KEY, () => undefined, { value: 'a', fetcher: load.fetcher });
    assert.equal(snapshotOf(KEY)?.value, 'a');
    await invalidate(KEY);
    assert.equal(snapshotOf(KEY)?.value, 'b');
    stop();
  });

  it('reloads when another tab says a key changed, and forgets all on sign-out', async () => {
    const load = counter(['a', 'b']);
    await getScreenData(KEY, load.fetcher);
    const stop = watch(KEY, () => undefined);
    const other = new BroadcastChannel('consultants-screen-data-v1');
    other.postMessage(['engagement']);
    other.postMessage({ not: 'a key' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(snapshotOf(KEY)?.value, 'b');
    other.close();
    clearScreenData();
    assert.equal(snapshotOf(KEY), null);
    stop();
  });
});

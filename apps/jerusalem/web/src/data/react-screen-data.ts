import { useSyncExternalStore } from 'react';
import { snapshotOf, watch, type Key, type Snapshot } from './screen-data.ts';

/**
 * What the screen shows for `key`, starting from its loader's value and following every later
 * load of the key, such as after a save elsewhere invalidated it (state-management-spec-he.md
 * 5.3). `fetcher` loads the key again when the loader did not run here.
 */
export function useScreenData<T>(key: Key, fromLoader: T, fetcher: () => Promise<T>): Snapshot<T> {
  const snapshot = useSyncExternalStore(
    (changed) => watch(key, changed, { value: fromLoader, fetcher }),
    () => snapshotOf<T>(key),
    () => null,
  );
  return snapshot ?? { value: fromLoader, failed: false };
}

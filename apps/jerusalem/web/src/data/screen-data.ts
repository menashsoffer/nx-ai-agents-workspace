// Data that one screen reads from the server, kept in memory by key, so a return to the screen
// shows what was there and a save refreshes only what it changed (state-management-spec-he.md
// 5.3). The catalog has its own versioned store and never goes through here. Nothing is kept
// on disk, and the server still checks access on every request.

export type Key = readonly string[];
/** What a screen shows for one key; a new object whenever anything in it changes. */
export interface Snapshot<T> {
  readonly value: T;
  /** The last refresh failed, so the value may miss a change that was saved. */
  readonly failed: boolean;
}
interface Entry {
  fetcher: () => Promise<unknown>;
  snapshot: Snapshot<unknown> | null;
  fetchedAt: number;
  stale: boolean;
  inflight: Promise<unknown> | null;
}

/** How long a value counts as fresh when a screen opens again. */
export const MAX_AGE_MS = 30_000;
const CHANNEL = 'consultants-screen-data-v1';

const entries = new Map<string, Entry>();
const watchers = new Map<string, Set<() => void>>();
let channel: BroadcastChannel | null = null;

const idOf = (key: Key) => JSON.stringify(key);
const startsWith = (id: string, prefix: Key) => id.startsWith(idOf(prefix).slice(0, -1));

function notify(id: string): void {
  for (const watcher of watchers.get(id) ?? []) watcher();
}

function fetchEntry(id: string, entry: Entry): Promise<unknown> {
  if (entry.inflight) return entry.inflight;
  const pending = entry.fetcher().then(
    (value) => {
      if (entries.get(id) !== entry) return value;
      Object.assign(entry, { snapshot: { value, failed: false }, fetchedAt: Date.now() });
      Object.assign(entry, { stale: false, inflight: null });
      notify(id);
      return value;
    },
    (error: unknown) => {
      entry.inflight = null;
      if (entry.snapshot && entries.get(id) === entry) {
        entry.snapshot = { ...entry.snapshot, failed: true };
        notify(id);
      }
      throw error;
    },
  );
  entry.inflight = pending;
  return pending;
}

const isFresh = (entry: Entry, now: number) => !entry.stale && now - entry.fetchedAt < MAX_AGE_MS;

/**
 * The value for `key`: from memory when fresh; when old, from memory at once while a new copy
 * loads behind it; otherwise from `fetcher`. Call it in the screen's loader.
 */
export async function getScreenData<T>(key: Key, fetcher: () => Promise<T>): Promise<T> {
  broadcast();
  const id = idOf(key);
  let entry = entries.get(id);
  if (!entry) {
    entry = { fetcher, snapshot: null, fetchedAt: 0, stale: true, inflight: null };
    entries.set(id, entry);
  }
  entry.fetcher = fetcher;
  if (entry.snapshot && isFresh(entry, Date.now())) return entry.snapshot.value as T;
  const pending = fetchEntry(id, entry);
  if (entry.snapshot) {
    pending.catch(() => undefined);
    return entry.snapshot.value as T;
  }
  return (await pending) as T;
}

function invalidateHere(prefix: Key): Promise<void>[] {
  const waits: Promise<void>[] = [];
  for (const [id, entry] of entries) {
    if (!startsWith(id, prefix)) continue;
    entry.stale = true;
    // Only what a screen shows now loads again; the rest waits for its next visit.
    if (watchers.get(id)?.size) waits.push(fetchEntry(id, entry).then(() => undefined));
  }
  return waits;
}

function broadcast(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const prefix: unknown = event.data;
    if (Array.isArray(prefix) && prefix.every((part) => typeof part === 'string'))
      for (const wait of invalidateHere(prefix)) wait.catch(() => undefined);
  };
  return channel;
}

/**
 * Marks every key that starts with `prefix` as changed, here and in the site's other tabs
 * (only the key crosses tabs, never data). Resolves once the shown values loaded again; a
 * failed load leaves the old value marked `failed` instead of rejecting.
 */
export async function invalidate(prefix: Key): Promise<void> {
  broadcast()?.postMessage([...prefix]);
  await Promise.allSettled(invalidateHere(prefix));
}

/** Like `invalidate`, for a write that tells the user when the list on screen is out of date. */
export async function refreshScreen(prefix: Key): Promise<void> {
  broadcast()?.postMessage([...prefix]);
  const results = await Promise.allSettled(invalidateHere(prefix));
  if (results.some((result) => result.status === 'rejected'))
    throw new Error('The screen could not load again');
}

export interface Seed<T> {
  value: T;
  fetcher: () => Promise<T>;
}

/**
 * For useSyncExternalStore: runs `watcher` whenever the value for `key` changes. A screen whose
 * loader did not run here (hydrated data) seeds the key with its value and how to load it.
 */
export function watch<T>(key: Key, watcher: () => void, seed?: Seed<T>): () => void {
  const id = idOf(key);
  if (seed && !entries.has(id)) {
    const snapshot = { value: seed.value, failed: false };
    const entry = { fetcher: seed.fetcher, snapshot, fetchedAt: Date.now(), stale: false };
    entries.set(id, { ...entry, inflight: null });
  }
  const set = watchers.get(id) ?? new Set();
  set.add(watcher);
  watchers.set(id, set);
  broadcast();
  return () => {
    set.delete(watcher);
  };
}

export function snapshotOf<T>(key: Key): Snapshot<T> | null {
  return (entries.get(idOf(key))?.snapshot ?? null) as Snapshot<T> | null;
}

/** Forgets everything: on sign-out and when another person signs in. */
export function clearScreenData(): void {
  const ids = [...entries.keys()];
  entries.clear();
  channel?.close();
  channel = null;
  for (const id of ids) notify(id);
}

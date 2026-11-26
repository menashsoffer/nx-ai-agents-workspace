import { useSyncExternalStore } from 'react';

// The suppliers picked for one engagement request, kept for the browser tab only. Ids only:
// names and contacts are loaded again from the database when the request page opens.

const KEY = 'consultants-shortlist-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same limit as public.last_approaches. */
export const SHORTLIST_MAX = 50;
const EMPTY: readonly string[] = [];
const listeners = new Set<() => void>();
let current: readonly string[] | null = null;
/** When a supplier was last added in this tab (ms); the catalog shows its tray for a while. */
let addedAt = 0;

/** Keeps valid, distinct ids up to the limit, in the order given. */
export function cleanIds(values: readonly unknown[]): string[] {
  const ids = values.filter((v): v is string => typeof v === 'string' && UUID.test(v));
  return [...new Set(ids.map((id) => id.toLowerCase()))].slice(0, SHORTLIST_MAX);
}

function read(): readonly string[] {
  if (current) return current;
  try {
    const raw: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? '[]');
    current = Array.isArray(raw) ? cleanIds(raw) : [];
  } catch {
    current = [];
  }
  return current;
}

function write(ids: readonly string[]): void {
  current = cleanIds(ids);
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage can be full or blocked; the list still works until the tab closes.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function shortlistIds(): readonly string[] {
  return typeof window === 'undefined' ? EMPTY : read();
}

/** Adds or removes one supplier. Returns false when the list is already full. */
export function toggleShortlist(id: string): boolean {
  const ids = shortlistIds();
  if (ids.includes(id)) {
    write(ids.filter((value) => value !== id));
    return true;
  }
  if (ids.length >= SHORTLIST_MAX) return false;
  addedAt = Date.now();
  write([...ids, id]);
  return true;
}

export function lastAddedAt(): number {
  return addedAt;
}

export function replaceShortlist(ids: readonly string[]): void {
  write(ids);
}

export function useShortlist(): readonly string[] {
  return useSyncExternalStore(subscribe, shortlistIds, () => EMPTY);
}

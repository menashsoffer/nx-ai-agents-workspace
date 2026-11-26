import { useSyncExternalStore } from 'react';

/** Phones: the width below which the tabs move to a bottom bar (shell.css). */
const NARROW = '(width < 48rem)';

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(NARROW)
    : null;
}

function subscribe(listener: () => void): () => void {
  const list = query();
  list?.addEventListener('change', listener);
  return () => list?.removeEventListener('change', listener);
}

/** True on a phone-width screen, for layouts that render different controls there. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
}

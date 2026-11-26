// Form drafts kept for the browser tab (state-management-spec-he.md 5.2). Session storage only:
// a draft never outlives the tab, so on a shared computer it does not wait for the next person.
// Storage that is full or blocked only means there is no draft.
import type { ZodType } from 'zod';

const PREFIX = 'form-draft:';

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/** The stored draft when it still fits the form's schema; anything else is dropped. */
export function readDraft<T>(key: string, schema: ZodType<T>): T | null {
  let raw: string | null | undefined;
  try {
    raw = storage()?.getItem(PREFIX + key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON: an old or damaged draft.
  }
  clearDraft(key);
  return null;
}

export function writeDraft(key: string, value: unknown): void {
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or privacy mode: the form still works, only without a draft.
  }
}

import { rpc, freshToken } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { loadSnapshot, saveMembership, writeContext } from '../../../data/site.ts';
import type { WriteContext } from '../../../data/write-context.ts';
import { refreshScreen, type Key } from '../../../data/screen-data.ts';

export interface SaveResult {
  message: string;
  error: string;
}
export const IDLE: SaveResult = { message: '', error: '' };

/**
 * Runs a write, then refreshes the shared catalog so every screen sees the change, and the
 * screen data under `changed` (the supplier's card), here and in other tabs.
 */
export async function saveAndRefresh(
  request: (token: string) => Promise<string>,
  changed: Key | null,
  saved: string | ((answer: string) => string),
): Promise<SaveResult> {
  let token: string;
  let answer: string;
  try {
    token = await freshToken();
    answer = await request(token);
  } catch (error) {
    return { message: '', error: error instanceof Error ? error.message : 'השמירה נכשלה.' };
  }
  try {
    await loadSnapshot(token);
    if (changed) await refreshScreen(changed);
  } catch {
    return {
      message: 'השינוי נשמר, אך התצוגה לא התרעננה. יש לרענן לפני ניסיון נוסף.',
      error: '',
    };
  }
  return { message: typeof saved === 'string' ? saved : saved(answer), error: '' };
}

export interface StatusChange {
  active: boolean;
  reason?: string;
  source?: string;
  changedOn?: string;
}
/** Admin only; the database refuses anyone else and requires a reason and date to deactivate. */
export const status = (supplierId: string, change: StatusChange) => async () => {
  await rpc('set_supplier_status', { target: supplierId, change }, z.null());
  return '';
};

export const membership = (payload: Record<string, string>) => (token: string) =>
  saveMembership(token, payload);

export async function loadWriteContext(): Promise<WriteContext> {
  return writeContext(await freshToken());
}

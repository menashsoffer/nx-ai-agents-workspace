import { invalidate } from '../../../data/screen-data.ts';
import { USERS_KEY } from './users.ts';
import { rows, rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { changeSchema, type ChangeRequest } from '../../../data/access-changes.ts';

/**
 * Pending role, unit and details changes this manager may decide (RLS shows only those and
 * one's own). Null until the change-request table exists in this environment.
 */
export type PendingChange = ChangeRequest & { user_id: string };
export async function loadChanges(me: string): Promise<PendingChange[] | null> {
  try {
    return await rows(
      'access_change_requests',
      { status: 'eq.pending', user_id: `neq.${me}`, order: 'created_at.asc' },
      z.array(changeSchema.extend({ user_id: z.string() })),
    );
  } catch {
    return null;
  }
}

export async function decideChange(id: string, approve: boolean, note: string): Promise<void> {
  await rpc('decide_access_change', { request_id: id, approve, note: note || null }, z.null());
  await invalidate(USERS_KEY);
}

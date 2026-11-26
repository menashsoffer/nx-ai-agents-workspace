import { rows, rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { invalidate } from '../../../data/screen-data.ts';
import {
  changeRequestSchema,
  checkResultSchema,
  submittedSchema,
  type ChangeRequest,
  type SupplierChange,
} from '../../../data/supplier-changes.ts';
import type { CheckedChange } from '../model/change-checks.ts';
import { requestAddressCheck } from './address-check.ts';

/** The supplier's waiting changes, under its screen key so a save on the card refreshes them. */
export const changesKey = (supplierId: string) => ['supplier', supplierId, 'changes'] as const;

/** Runs the database checks on every change without saving anything (spec section 6.6). */
export async function checkChanges(changes: readonly SupplierChange[]): Promise<CheckedChange[]> {
  return Promise.all(
    changes.map(async (change) => ({
      change,
      result: await rpc('check_supplier_change', { change }, checkResultSchema),
    })),
  );
}

/**
 * Saves the changes one by one with the reason, and returns a sentence of what happened:
 * how many were saved and how many wait for a decision.
 */
export async function submitChanges(
  changes: readonly SupplierChange[],
  reason: string,
): Promise<string> {
  let saved = 0;
  let waiting = 0;
  for (const change of changes) {
    const answer = await rpc(
      'submit_supplier_change',
      { change: reason ? { ...change, reason } : change },
      submittedSchema,
    );
    if (answer.status === 'pending') waiting += 1;
    else saved += 1;
  }
  if (changes.some((c) => c.contact_kind === 'address' && saved > 0)) requestAddressCheck();
  if (waiting === 0) return 'השינויים נשמרו.';
  if (saved === 0) return 'השינויים נשלחו לאישור. הם יופיעו אחרי שיאושרו.';
  return `נשמרו ${String(saved)} שינויים, ו-${String(waiting)} נשלחו לאישור.`;
}

/** Waiting changes the signed-in person may see (RLS); an empty list for anyone else. */
export function loadPendingChanges(supplierId: string): Promise<ChangeRequest[]> {
  return rows(
    'supplier_change_requests',
    {
      supplier_id: `eq.${supplierId}`,
      status: 'eq.pending',
      order: 'created_at.asc',
    },
    z.array(changeRequestSchema),
  );
}

export async function decideChange(
  request: ChangeRequest,
  approve: boolean,
  note: string,
): Promise<void> {
  await rpc(
    'decide_supplier_change',
    { request_id: request.id, approve, note: note || null },
    z.null(),
  );
  await invalidate(['supplier', request.supplier_id]);
}

export async function cancelChange(request: ChangeRequest): Promise<void> {
  await rpc('cancel_supplier_change', { request_id: request.id }, z.null());
  await invalidate(changesKey(request.supplier_id));
}

import { DataError } from '../../../data/client.ts';
import { rows, rpc, requireRoles } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { loadChanges } from './changes.ts';
import { invalidate } from '../../../data/screen-data.ts';
const role = z.enum(['viewer', 'editor', 'unit_manager', 'admin', 'auditor']);
export const profileSchema = z.object({
  user_id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string(),
  job_title: z.string(),
  unit_id: z.string().nullable(),
  purpose: z.string(),
  status: z.enum(['active', 'pending', 'rejected', 'blocked']),
});
export const grantSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  role,
  unit_id: z.string().nullable(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
const unitSchema = z.object({ id: z.string(), name: z.string() });
export type Profile = z.infer<typeof profileSchema>;
export type GrantRow = z.infer<typeof grantSchema>;
export type Unit = z.infer<typeof unitSchema>;
/** The screen's key in the screen data (state-management-spec-he.md 5.3). */
export const USERS_KEY = ['users'] as const;
/** Every write below marks the screen changed, so it shows the change at once. */
const changed = () => invalidate(USERS_KEY);

export async function loadUsers() {
  const who = await requireRoles(['admin', 'unit_manager']);
  const [profiles, grants, units, changes] = await Promise.all([
    rows('profiles', {}, z.array(profileSchema)),
    rows('role_grants', { revoked_at: 'is.null' }, z.array(grantSchema)),
    rows('org_units', { active: 'eq.true' }, z.array(unitSchema)),
    loadChanges(who.userId),
  ]);
  return { who, profiles, grants, units, changes, now: Date.now() };
}
export async function reviewProfile(
  userId: string,
  decision: 'active' | 'rejected',
  note: string,
): Promise<void> {
  await rpc('decide_profile', { target_user: userId, decision, note: note || null }, z.null());
  await changed();
}
export async function removeGrant(id: string): Promise<void> {
  await rpc('revoke_role', { grant_id: id }, z.null());
  await changed();
}
export const grantInputSchema = z.object({
  target_user: z.string().min(1),
  wanted_role: role,
  target_unit: z.string().nullable(),
});
export type GrantInput = z.infer<typeof grantInputSchema>;
export async function addGrant(input: GrantInput): Promise<void> {
  await rpc('grant_role', input, z.string());
  await changed();
}

export interface Approval {
  userId: string;
  role: GrantInput['wanted_role'];
  /** The unit of the role; the request's own unit when it is the same. */
  unit: string | null;
  requestUnit: string | null;
}
/**
 * Approves and grants the chosen role in one database step (decision 4). Where that function is
 * not deployed yet, a plain viewer approval of the request's unit still works the old way.
 */
export async function approveProfile({ userId, role, unit, requestUnit }: Approval) {
  try {
    await rpc(
      'approve_profile',
      { target_user: userId, wanted_role: role, target_unit: unit, note: null },
      z.null(),
    );
    await changed();
  } catch (error) {
    const missing = error instanceof DataError && error.status === 404;
    if (!missing || role !== 'viewer' || unit !== requestUnit) throw error;
    await reviewProfile(userId, 'active', '');
  }
}

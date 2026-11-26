import { insertProfile, rows, rpc, sessionToken, type Identity } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { tokenEmail } from '../../../data/snapshot.ts';
import { authUser } from '../../../data/site.ts';
import { changeSchema, type ChangeRequest } from '../../../data/access-changes.ts';
import type { AccessInput, ChangeInput } from '../model/account-forms.ts';

export type { ChangeRequest };

const role = z.enum(['viewer', 'editor', 'unit_manager', 'admin', 'auditor']);
const profileSchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  email: z.string(),
  job_title: z.string(),
  phone: z.string().nullable(),
  unit_id: z.string().nullable(),
  created_at: z.string(),
});
const unitSchema = z.object({ id: z.string(), name: z.string() });
const grantSchema = z.object({ id: z.string(), role, unit_id: z.string().nullable() });
export type MyProfile = z.infer<typeof profileSchema>;
export type MyGrant = z.infer<typeof grantSchema>;
export type Unit = z.infer<typeof unitSchema>;

export interface Account {
  profile: MyProfile | null;
  units: Unit[];
  grants: MyGrant[];
  /** Null until the change-request table exists in this environment. */
  changes: ChangeRequest[] | null;
  /** When this account last signed in, as Supabase Auth records it; null if unknown. */
  signedInAt: string | null;
  /** An admin's own changes are applied at once, without anyone's approval. */
  admin: boolean;
}

const authSchema = z.object({ last_sign_in_at: z.string().nullish() });
/** A nicety on the personal area: any failure leaves it out instead of failing the screen. */
export async function lastSignIn(): Promise<string | null> {
  try {
    const response = await authUser(sessionToken());
    if (!response.ok) return null;
    return authSchema.parse(await response.json()).last_sign_in_at ?? null;
  } catch {
    return null;
  }
}

const departments = () =>
  rows(
    'org_units',
    { active: 'eq.true', kind: 'eq.department', order: 'name.asc' },
    z.array(unitSchema),
  );

async function myChanges(userId: string): Promise<ChangeRequest[] | null> {
  try {
    return await rows(
      'access_change_requests',
      { user_id: `eq.${userId}`, order: 'created_at.desc' },
      z.array(changeSchema),
    );
  } catch {
    return null;
  }
}

/** Everything the account screen shows, by the signed-in person's state. */
export async function loadAccount(who: Identity): Promise<Account> {
  const { state } = who.access;
  if (state === 'unregistered')
    return {
      profile: null,
      units: await departments(),
      grants: [],
      changes: null,
      signedInAt: null,
      admin: false,
    };
  const mine = { user_id: `eq.${who.userId}` };
  const profile = (await rows('profiles', mine, z.array(profileSchema)))[0] ?? null;
  if (state !== 'active')
    return { profile, units: [], grants: [], changes: null, signedInAt: null, admin: false };
  const [units, grants, changes, signedInAt] = await Promise.all([
    departments(),
    rows('role_grants', { ...mine, revoked_at: 'is.null' }, z.array(grantSchema)),
    myChanges(who.userId),
    lastSignIn(),
  ]);
  return { profile, units, grants, changes, signedInAt, admin: who.access.admin };
}

export async function requestAccess(userId: string, input: AccessInput): Promise<void> {
  const email = tokenEmail(sessionToken());
  if (!email) throw new Error('לא ניתן לזהות את כתובת הדוא״ל של החשבון. יש להתחבר שוב.');
  await insertProfile({ user_id: userId, email, ...input });
}

export async function askDetails(details: Record<string, string>, why: string): Promise<void> {
  await rpc(
    'request_access_change',
    { change_kind: 'details', why, new_details: details },
    z.string(),
  );
}

export async function askChange(input: ChangeInput): Promise<void> {
  await rpc(
    'request_access_change',
    {
      change_kind: input.kind,
      why: input.reason,
      wanted_role: input.kind === 'add_role' ? input.role || null : null,
      target_unit: input.kind === 'remove_role' ? null : input.unit_id || null,
      target_grant: input.kind === 'remove_role' ? input.grant_id : null,
    },
    z.string(),
  );
}

export async function cancelChange(id: string): Promise<void> {
  await rpc('cancel_access_change', { request_id: id }, z.null());
}

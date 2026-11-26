import { rows, rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { errorText } from '../../../data/errors.ts';

/** The supplier area's address, sent to the supplier by hand: version 1 sends no email. */
export function areaLink(location: Pick<Location, 'origin' | 'pathname'> = window.location) {
  return `${location.origin}${location.pathname}#/supplier-area`;
}

/** Invites the person behind one of the supplier's own emails (supplier-portal spec 5.1). */
export async function inviteToArea(supplierId: string, email: string): Promise<string> {
  try {
    await rpc('invite_supplier_account', { supplier_id: supplierId, email }, z.string());
    return '';
  } catch (error) {
    return errorText(error);
  }
}

const accountSchema = z.object({
  id: z.string(),
  role: z.enum(['owner', 'member']),
  status: z.enum(['pending', 'active', 'rejected', 'revoked']),
  method: z.enum(['invite', 'email_match', 'document']),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  decision_note: z.string().nullable(),
  email: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  job_title: z.string().nullable(),
});
export type AreaAccount = z.infer<typeof accountSchema>;

/** Everyone linked to the supplier, newest first (supplier-portal spec 6.10). */
export const loadAreaAccounts = (supplierId: string) =>
  rpc('supplier_area_accounts', { target: supplierId }, z.array(accountSchema));

/** Ends a link at once; the person sees the reason. Returns an error sentence or ''. */
export async function revokeAreaAccount(id: string, note: string): Promise<string> {
  try {
    await rpc('revoke_supplier_account', { account_id: id, note }, z.null());
    return '';
  } catch (error) {
    return errorText(error);
  }
}

const inviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
});

/** The supplier's invites, newest first (RLS supplier_invites_read: staff only). */
export const loadInvites = (supplierId: string) =>
  rows(
    'supplier_invites',
    { supplier_id: `eq.${supplierId}`, order: 'created_at.desc' },
    z.array(inviteSchema),
  );

// "המשתמשים שלנו" (supplier-portal-spec-he.md 6.8): an owner's view of the supplier's people.
import { rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';

const roleSchema = z.enum(['owner', 'member']);
const memberSchema = z.object({
  id: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  job_title: z.string().nullable(),
  email: z.string().nullable(),
  role: roleSchema,
  method: z.enum(['invite', 'email_match', 'document']),
  created_at: z.string(),
  is_me: z.boolean(),
});
const openInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: roleSchema,
  expires_at: z.string(),
});
const membersSchema = z.object({
  members: z.array(memberSchema),
  invites: z.array(openInviteSchema),
});
export type Member = z.infer<typeof memberSchema>;
export type OpenInvite = z.infer<typeof openInviteSchema>;
export type Members = z.infer<typeof membersSchema>;
export type MemberRole = z.infer<typeof roleSchema>;

export const loadMembers = (supplierId: string) =>
  rpc('portal_members', { supplier_id: supplierId }, membersSchema);

export interface MemberInvite {
  supplierId: string;
  email: string;
  role: MemberRole;
}
export const inviteMember = ({ supplierId, email, role }: MemberInvite) =>
  rpc('portal_invite_member', { invite: { supplier_id: supplierId, email, role } }, z.string());

export const cancelInvite = (id: string) =>
  rpc('portal_cancel_invite', { invite_id: id }, z.null());

export const removeMember = (id: string) =>
  rpc('portal_remove_member', { account_id: id }, z.null());

/** The supplier area's address, passed on by hand: version 1 sends no email (decision 7). */
export function areaLink(location: Pick<Location, 'origin' | 'pathname'> = window.location) {
  return `${location.origin}${location.pathname}#/supplier-area`;
}

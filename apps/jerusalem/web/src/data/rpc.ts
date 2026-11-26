// The mini build keeps the first screen small; lazy screens use the full build.
import * as z from 'zod/mini';
import type { ZodType } from 'zod';
z.config({ jitless: true });
import type { PublicSchema } from '../database.types.ts';
import type { Session } from './session.ts';
import { data, loadSnapshot, refreshGrant } from './site.ts';
import { SessionKeeper } from './auth-session.ts';
import { MemoryStorage } from './memory-storage.ts';
import type { Access, Role } from './access.ts';
import { DataError } from './client.ts';
import { tagRequest } from '../lib/telemetry.ts';
import type { SupplierChange } from './supplier-changes.ts';
import type { RegistryRpc } from './registry-rpc.ts';

/** An approach answer, from the supplier area or recorded by staff. */
type AnswerParts = Partial<Record<'offer_amount' | 'file_path' | 'decline_reason', string>> & {
  approach_id: string;
  answer: 'offer' | 'declined';
  note: string;
  offer_includes_vat?: boolean;
};

interface AdminRpc extends RegistryRpc {
  decide_threshold_proposal: { proposal: string; approve: boolean; note?: string | null };
  decide_profile: { target_user: string; decision: 'active' | 'rejected'; note: string | null };
  approve_profile: {
    target_user: string;
    wanted_role: Role;
    target_unit: string | null;
    note: string | null;
  };
  grant_role: { target_user: string; wanted_role: Role; target_unit: string | null };
  revoke_role: { grant_id: string };
  decide_identifier_candidate: { candidate: string; accept: boolean };
  decide_kind_suggestion: { target: string; accept: boolean };
  suggest_supplier_kinds: Record<string, never>;
  set_supplier_status: {
    target: string;
    change: { active: boolean; reason?: string; source?: string; changedOn?: string };
  };
  create_engagement_request: {
    draft: {
      unit_id: string;
      subject: string;
      estimated_value: number;
      value_includes_vat: boolean;
      requested_exemption: string | null;
    };
  };
  update_engagement_request: {
    request: string;
    draft: Omit<AdminRpc['create_engagement_request']['draft'], 'unit_id'>;
  };
  cancel_engagement_request: { request: string; note: string };
  record_supplier_approaches: {
    request: string;
    suppliers: string[];
    channel: 'email' | 'phone' | 'portal' | 'letter' | 'other';
    respond_by: string | null;
  };
  request_approaches: { request_id: string };
  record_approach_answer: { answer: AnswerParts & { received_on: string } };
  extend_approach_deadline: { request: string; respond_by: string; reason: string };
  last_approaches: { suppliers: string[] };
  load_control: Record<string, never>;
  error_summary: Record<string, never>;
  error_cases: { days: number | null };
  usage_summary: { from_day: string; to_day: string; only_role: string | null };
  addresses_to_check: Record<string, never>;
  admin_overview: Record<string, never>;
  request_access_change: {
    change_kind: 'add_role' | 'remove_role' | 'move_unit' | 'details';
    why: string;
    wanted_role?: Role | null;
    target_unit?: string | null;
    target_grant?: string | null;
    new_details?: Record<string, string> | null;
  };
  cancel_access_change: { request_id: string };
  decide_access_change: { request_id: string; approve: boolean; note: string | null };
  decide_category_request: {
    request_id: string;
    decision: 'approved' | 'rejected' | 'linked';
    note: string;
    category_id: string | null;
  };
  // The supplier personal area (supplier-portal-spec-he.md 7.2).
  portal_me: Record<string, never>;
  portal_find_supplier: { scheme: 'company' | 'nonprofit'; value: string };
  portal_request_link: { request: { supplier_id: string; proof_path: string | null } };
  portal_accept_invite: { invite_id: string };
  portal_supplier: { supplier_id: string };
  supplier_link_queue: Record<string, never>;
  decide_supplier_account: { account_id: string; approve: boolean; note: string | null };
  revoke_supplier_account: { account_id: string; note: string };
  invite_supplier_account: { supplier_id: string; email: string };
  supplier_area_accounts: { target: string };
  portal_propose_change: { change: SupplierChange };
  portal_changes: { supplier_id: string };
  portal_documents: { supplier_id: string };
  portal_save_document: {
    document: { supplier_id: string; kind: string; storage_path: string; valid_until: string };
  };
  supplier_document_queue: Record<string, never>;
  decide_supplier_document: {
    document_id: string;
    approve: boolean;
    note: string | null;
    corrected_until: string | null;
  };
  portal_members: { supplier_id: string };
  portal_approaches: { supplier_id: string };
  portal_answer_approach: { answer: AnswerParts };
  portal_withdraw_answer: { response_id: string };
  portal_invite_member: { invite: { supplier_id: string; email: string; role: string } };
  portal_cancel_invite: { invite_id: string };
  portal_remove_member: { account_id: string };
  check_supplier_change: { change: SupplierChange };
  submit_supplier_change: { change: SupplierChange };
  decide_supplier_change: { request_id: string; approve: boolean; note: string | null };
  cancel_supplier_change: { request_id: string };
  // Supplier import from Excel (supplier-excel-import-spec-he.md, section 10).
  stage_excel_import: { batch: Record<string, unknown> };
  decide_import_rows: { decisions: Record<string, unknown>[] };
  apply_import_batch: { batch: string };
}
// Existing SQL RPCs not yet covered by the snapshot-only generator.
declare module '../database.types.ts' {
  interface PublicFunctions {
    decide_threshold_proposal: {
      Args: AdminRpc['decide_threshold_proposal'];
      Returns: string | null;
    };
    decide_profile: { Args: AdminRpc['decide_profile']; Returns: null };
    approve_profile: { Args: AdminRpc['approve_profile']; Returns: null };
    grant_role: { Args: AdminRpc['grant_role']; Returns: string };
    revoke_role: { Args: AdminRpc['revoke_role']; Returns: null };
    decide_identifier_candidate: {
      Args: AdminRpc['decide_identifier_candidate'];
      Returns: string | null;
    };
    decide_category_request: { Args: AdminRpc['decide_category_request']; Returns: string | null };
    decide_kind_suggestion: { Args: AdminRpc['decide_kind_suggestion']; Returns: string };
    suggest_supplier_kinds: { Args: AdminRpc['suggest_supplier_kinds']; Returns: unknown };
    set_supplier_status: { Args: AdminRpc['set_supplier_status']; Returns: null };
    create_engagement_request: { Args: AdminRpc['create_engagement_request']; Returns: string };
    update_engagement_request: { Args: AdminRpc['update_engagement_request']; Returns: null };
    cancel_engagement_request: { Args: AdminRpc['cancel_engagement_request']; Returns: null };
    record_supplier_approaches: { Args: AdminRpc['record_supplier_approaches']; Returns: number };
    request_approaches: { Args: AdminRpc['request_approaches']; Returns: unknown };
    record_approach_answer: { Args: AdminRpc['record_approach_answer']; Returns: unknown };
    extend_approach_deadline: { Args: AdminRpc['extend_approach_deadline']; Returns: number };
    load_control: { Args: AdminRpc['load_control']; Returns: unknown };
    error_summary: { Args: AdminRpc['error_summary']; Returns: unknown };
    error_cases: { Args: AdminRpc['error_cases']; Returns: unknown };
    usage_summary: { Args: AdminRpc['usage_summary']; Returns: unknown };
    addresses_to_check: { Args: AdminRpc['addresses_to_check']; Returns: unknown };
    admin_overview: { Args: AdminRpc['admin_overview']; Returns: unknown };
    request_access_change: { Args: AdminRpc['request_access_change']; Returns: string };
    cancel_access_change: { Args: AdminRpc['cancel_access_change']; Returns: null };
    decide_access_change: { Args: AdminRpc['decide_access_change']; Returns: null };
    check_supplier_change: { Args: AdminRpc['check_supplier_change']; Returns: unknown };
    submit_supplier_change: { Args: AdminRpc['submit_supplier_change']; Returns: unknown };
    decide_supplier_change: { Args: AdminRpc['decide_supplier_change']; Returns: null };
    cancel_supplier_change: { Args: AdminRpc['cancel_supplier_change']; Returns: null };
    last_approaches: {
      Args: AdminRpc['last_approaches'];
      Returns: { supplier_id: string; last_on: string }[];
    };
    portal_me: { Args: AdminRpc['portal_me']; Returns: unknown };
    portal_find_supplier: { Args: AdminRpc['portal_find_supplier']; Returns: unknown };
    portal_request_link: { Args: AdminRpc['portal_request_link']; Returns: unknown };
    portal_accept_invite: { Args: AdminRpc['portal_accept_invite']; Returns: unknown };
    portal_supplier: { Args: AdminRpc['portal_supplier']; Returns: unknown };
    supplier_link_queue: { Args: AdminRpc['supplier_link_queue']; Returns: unknown };
    invite_supplier_account: { Args: AdminRpc['invite_supplier_account']; Returns: string };
    decide_supplier_account: { Args: AdminRpc['decide_supplier_account']; Returns: null };
    revoke_supplier_account: { Args: AdminRpc['revoke_supplier_account']; Returns: null };
    supplier_area_accounts: { Args: AdminRpc['supplier_area_accounts']; Returns: unknown };
    portal_propose_change: { Args: AdminRpc['portal_propose_change']; Returns: unknown };
    portal_changes: { Args: AdminRpc['portal_changes']; Returns: unknown };
    portal_documents: { Args: AdminRpc['portal_documents']; Returns: unknown };
    portal_save_document: { Args: AdminRpc['portal_save_document']; Returns: unknown };
    supplier_document_queue: { Args: AdminRpc['supplier_document_queue']; Returns: unknown };
    decide_supplier_document: { Args: AdminRpc['decide_supplier_document']; Returns: null };
    portal_members: { Args: AdminRpc['portal_members']; Returns: unknown };
    portal_approaches: { Args: AdminRpc['portal_approaches']; Returns: unknown };
    portal_answer_approach: { Args: AdminRpc['portal_answer_approach']; Returns: unknown };
    portal_withdraw_answer: { Args: AdminRpc['portal_withdraw_answer']; Returns: null };
    portal_invite_member: { Args: AdminRpc['portal_invite_member']; Returns: string };
    portal_cancel_invite: { Args: AdminRpc['portal_cancel_invite']; Returns: null };
    portal_remove_member: { Args: AdminRpc['portal_remove_member']; Returns: null };
    stage_excel_import: { Args: AdminRpc['stage_excel_import']; Returns: unknown };
    decide_import_rows: { Args: AdminRpc['decide_import_rows']; Returns: number };
    apply_import_batch: { Args: AdminRpc['apply_import_batch']; Returns: unknown };
  }
}
const accessSchema = z.object({
  state: z.enum(['active', 'pending', 'rejected', 'blocked', 'unregistered']),
  member: z.boolean(),
  admin: z.boolean(),
  editor: z.boolean(),
  manager: z.boolean(),
  grants: z.array(
    z.object({
      role: z.enum(['viewer', 'editor', 'unit_manager', 'admin', 'auditor']),
      unitId: z.nullable(z.string()),
    }),
  ),
});
let keeper = new SessionKeeper({ storage: new MemoryStorage(), refresh: refreshGrant });
let bootMessage = '';
/** The browser entry installs a keeper backed by localStorage before the router starts. */
export function installKeeper(value: SessionKeeper): void {
  keeper = value;
}
export function getKeeper(): SessionKeeper {
  return keeper;
}
export function setAdminSession(value: Session | null, message = ''): void {
  keeper.adopt(value);
  bootMessage = message;
}
export function getAdminSession(): Session | null {
  return keeper.current();
}
export function getBootMessage(): string {
  return bootMessage;
}
/** The current access token, without renewing it; loaders that cannot wait use this. */
export function sessionToken(): string {
  const session = keeper.current();
  if (!session || session.exp <= Date.now()) throw new DataError(401);
  return session.token;
}
/** An access token with time left, renewed first when it is about to expire. */
export async function freshToken(): Promise<string> {
  const session = await keeper.fresh();
  if (!session) throw new DataError(401);
  return session.token;
}
/** After a 401: a renewed token, or null once the session cannot be renewed. */
export async function recoverSession(failedToken: string): Promise<string | null> {
  const session = await keeper.recover(failedToken);
  return session?.token ?? null;
}
export interface Identity {
  userId: string;
  access: Access;
}
/** Runs a request with a fresh token, and once more with a renewed token after a 401. */
async function authorized<T>(request: (token: string) => Promise<T>): Promise<T> {
  const token = await freshToken();
  try {
    return await request(token);
  } catch (error) {
    if (!(error instanceof DataError && error.status === 401)) throw error;
    const renewed = await recoverSession(token);
    if (!renewed) throw error;
    return request(renewed);
  }
}
/** All roles come from the existing server access loader, never from JWT app_metadata. */
let pendingIdentity: Promise<Identity> | null = null;
// Checks that start together share one load; a second would fail the first (error-details 7).
export function identity(): Promise<Identity> {
  return (pendingIdentity ??= loadIdentity().finally(() => (pendingIdentity = null)));
}
async function loadIdentity(): Promise<Identity> {
  const state = await authorized((token) => loadSnapshot(token));
  return { userId: state.userId, access: accessSchema.parse(state.access) };
}
export function permitted(access: Access, roles: readonly Role[]): boolean {
  return (
    access.state === 'active' && (access.admin || access.grants.some((g) => roles.includes(g.role)))
  );
}
export async function requireRoles(roles: readonly Role[]): Promise<Identity> {
  const who = await identity();
  if (!permitted(who.access, roles)) throw new DataError(403);
  return who;
}
export async function rpc<K extends keyof AdminRpc, T>(
  name: K,
  args: AdminRpc[K],
  schema: ZodType<T>,
): Promise<T> {
  try {
    return schema.parse(await authorized((token) => data(token).rpc(name, args)));
  } catch (error) {
    throw tagRequest(error, name);
  }
}
/** A signed-in person's own access request (RLS policy profiles_signup). */
export async function insertProfile(row: PublicSchema['profiles']['Insert']): Promise<void> {
  await authorized((token) => data(token).insert('profiles', row));
}
export async function rows<T>(
  table: keyof PublicSchema,
  filters: Record<string, string>,
  schema: ZodType<T>,
): Promise<T> {
  return schema.parse(await authorized((token) => data(token).list(table, filters)));
}
type PortalPerson = PublicSchema['portal_people']['Insert'];
/** The signed-in person's own supplier-side details (RLS portal_people_*_own). */
export async function savePortalPerson(row: PortalPerson, exists: boolean): Promise<void> {
  const { user_id: userId, ...details } = row;
  await authorized((token) =>
    exists
      ? data(token).update('portal_people', { user_id: `eq.${userId}` }, details)
      : data(token).insert('portal_people', row),
  );
}

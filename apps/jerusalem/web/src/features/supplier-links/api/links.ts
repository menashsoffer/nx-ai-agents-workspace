// The admin's queue of supplier-area links (supplier-portal-spec-he.md 6.10).
import { rpc, requireRoles } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { errorText } from '../../../data/errors.ts';
import { refreshScreen } from '../../../data/screen-data.ts';

export const SUPPLIER_LINKS_KEY = ['supplier-links'] as const;

const linkSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  supplier_name: z.string(),
  status: z.enum(['pending', 'active']),
  method: z.enum(['invite', 'email_match', 'document']),
  proof_path: z.string().nullable(),
  created_at: z.string(),
  email: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  job_title: z.string().nullable(),
  phone: z.string().nullable(),
});
export type SupplierLink = z.infer<typeof linkSchema>;

export async function loadLinks(): Promise<SupplierLink[]> {
  await requireRoles(['admin']);
  return rpc('supplier_link_queue', {}, z.array(linkSchema));
}

/** Runs a decision, refreshes the queue, and returns an error sentence or ''. */
async function decided(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return errorText(error);
  }
  await refreshScreen(SUPPLIER_LINKS_KEY).catch(() => undefined);
  return '';
}

export const approveLink = (id: string) =>
  decided(() =>
    rpc('decide_supplier_account', { account_id: id, approve: true, note: null }, z.null()),
  );

export const rejectLink = (id: string, note: string) =>
  decided(() => rpc('decide_supplier_account', { account_id: id, approve: false, note }, z.null()));

export const revokeLink = (id: string, note: string) =>
  decided(() => rpc('revoke_supplier_account', { account_id: id, note }, z.null()));

/** A link to the proof file that works for 5 minutes (the bucket is private). */
export { signedFileUrl as proofUrl } from '../../../data/files.ts';

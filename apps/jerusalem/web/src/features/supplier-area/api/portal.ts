// The supplier side of the site (supplier-portal-spec-he.md 7.2). Every call goes through a
// portal_* database function; the browser never reads a staff table for a supplier.
import { rpc, freshToken, sessionToken, savePortalPerson } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { tokenUserId } from '../../../data/snapshot.ts';
import { DataError, failedResponse } from '../../../data/client.ts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../../data/environment.ts';

const accountSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  supplier_name: z.string(),
  role: z.enum(['owner', 'member']),
  status: z.enum(['pending', 'active', 'rejected', 'revoked']),
  method: z.enum(['invite', 'email_match', 'document']),
  decision_note: z.string().nullable(),
  created_at: z.string(),
});
const personSchema = z.object({
  user_id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  job_title: z.string().nullable(),
  phone: z.string().nullable(),
});
const inviteSchema = z.object({
  id: z.string(),
  supplier_name: z.string(),
  role: z.enum(['owner', 'member']),
  expires_at: z.string(),
});
const meSchema = z.object({
  email: z.string(),
  person: personSchema.nullable(),
  accounts: z.array(accountSchema),
  invites: z.array(inviteSchema),
});
export type PortalAccount = z.infer<typeof accountSchema>;
export type PortalInvite = z.infer<typeof inviteSchema>;
export type PortalPerson = z.infer<typeof personSchema>;
export type PortalMe = z.infer<typeof meSchema>;

const fileSchema = z.object({
  id: z.string(),
  name: z.string(),
  entity_kind: z.string(),
  website: z.string().nullable(),
  role: z.enum(['owner', 'member']),
  other_names: z.array(z.string()),
  identifiers: z.array(z.object({ scheme: z.string(), value: z.string(), verified: z.boolean() })),
  contacts: z.array(z.object({ id: z.string(), kind: z.string(), value: z.string() })),
  memberships: z.array(
    z.object({
      registry: z.string(),
      unit: z.string().nullable(),
      field: z.string().nullable(),
      registered_from: z.string().nullable(),
      registered_until: z.string().nullable(),
      document_url: z.string().nullable(),
    }),
  ),
});
export type SupplierFile = z.infer<typeof fileSchema>;

export const loadMe = () => rpc('portal_me', {}, meSchema);

export const loadFile = (supplierId: string) =>
  rpc('portal_supplier', { supplier_id: supplierId }, fileSchema);

const foundSchema = z.object({ supplier_id: z.string(), name: z.string() }).nullable();
export const findSupplier = (scheme: 'company' | 'nonprofit', value: string) =>
  rpc('portal_find_supplier', { scheme, value }, foundSchema);

const linkSchema = z.object({ account_id: z.string(), status: z.enum(['pending', 'active']) });
export const requestLink = (supplierId: string, proofPath: string | null) =>
  rpc(
    'portal_request_link',
    { request: { supplier_id: supplierId, proof_path: proofPath } },
    linkSchema,
  );

const proposalSchema = z.object({
  id: z.string(),
  kind: z.enum(['rename', 'entity_kind', 'contact']),
  contact_kind: z.string().nullable(),
  old_value: z.string().nullable(),
  new_value: z.string(),
  status: z.enum(['pending', 'applied', 'approved', 'rejected', 'cancelled']),
  decision_note: z.string().nullable(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  mine: z.boolean(),
});
export type Proposal = z.infer<typeof proposalSchema>;

/** The supplier's proposed fixes, newest first, without the checks (spec 6.3). */
export const loadProposals = (supplierId: string) =>
  rpc('portal_changes', { supplier_id: supplierId }, z.array(proposalSchema));

export interface ProposalInput {
  supplier_id: string;
  kind: 'rename' | 'contact';
  value: string;
  contact_kind?: string;
  contact_id?: string;
  reason?: string;
}
/** Sends a fix; it always waits for the municipality (decision 4). */
export const proposeChange = (change: ProposalInput) =>
  rpc(
    'portal_propose_change',
    { change },
    z.object({ request_id: z.string(), status: z.literal('pending') }),
  );

export const cancelProposal = (id: string) =>
  rpc('cancel_supplier_change', { request_id: id }, z.null());

export const acceptInvite = (inviteId: string) =>
  rpc('portal_accept_invite', { invite_id: inviteId }, linkSchema);

export const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** The file name in the bucket: a fresh id and the extension of its type. */
export const fileName = (file: Pick<File, 'type'>, id: string) =>
  `${id}.${EXTENSION[file.type] ?? 'bin'}`;

/** Where a person's proof goes: only their own folder accepts it (storage policy). */
export function proofPath(userId: string, file: Pick<File, 'type'>, id: string): string {
  return `link-proofs/${userId}/${fileName(file, id)}`;
}

/** Uploads a file to the private bucket at `path`; the storage policy decides who may. */
export async function uploadFile(path: string, file: File, upload: typeof fetch = fetch) {
  const response = await upload(`${SUPABASE_URL}/storage/v1/object/supplier-documents/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${await freshToken()}`,
      'Content-Type': file.type,
    },
    body: file,
  });
  if (!response.ok) throw await failedResponse(response);
}

/** Uploads a proof file to the private bucket and returns its path. */
export async function uploadProof(file: File, upload: typeof fetch = fetch): Promise<string> {
  const userId = tokenUserId(sessionToken());
  if (!userId) throw new DataError(401);
  const path = proofPath(userId, file, crypto.randomUUID());
  await uploadFile(path, file, upload);
  return path;
}

export interface PersonInput {
  first_name: string;
  last_name: string;
  job_title: string;
  phone: string;
}
/** Saves the person's own name, job title and phone; a new person gets a new row. */
export async function savePerson(input: PersonInput, exists: boolean): Promise<void> {
  const userId = tokenUserId(sessionToken());
  if (!userId) throw new DataError(401);
  const row = { user_id: userId, ...input, job_title: input.job_title || null };
  await savePortalPerson({ ...row, phone: input.phone || null }, exists);
}

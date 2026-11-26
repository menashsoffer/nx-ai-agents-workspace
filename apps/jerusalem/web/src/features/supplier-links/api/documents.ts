// The admin's queue of supplier documents (supplier-portal-spec-he.md 6.5, decision 3).
import { rpc, requireRoles } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { errorText } from '../../../data/errors.ts';
import { refreshScreen } from '../../../data/screen-data.ts';
import { DOCUMENT_KINDS } from './document-kinds.ts';

export const SUPPLIER_DOCUMENTS_KEY = ['supplier-documents'] as const;

const queuedSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  supplier_name: z.string(),
  kind: z.enum(DOCUMENT_KINDS),
  valid_until: z.string(),
  created_at: z.string(),
  storage_path: z.string(),
});
export type QueuedDocument = z.infer<typeof queuedSchema>;

export async function loadDocumentQueue(): Promise<QueuedDocument[]> {
  await requireRoles(['admin']);
  return rpc('supplier_document_queue', {}, z.array(queuedSchema));
}

async function decided(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return errorText(error);
  }
  await refreshScreen(SUPPLIER_DOCUMENTS_KEY).catch(() => undefined);
  return '';
}

/** Approves a document; `until` corrects its valid-until date when it differs. */
export const approveDocument = (id: string, until: string | null) =>
  decided(() =>
    rpc(
      'decide_supplier_document',
      { document_id: id, approve: true, note: null, corrected_until: until },
      z.null(),
    ),
  );

export const rejectDocument = (id: string, note: string) =>
  decided(() =>
    rpc(
      'decide_supplier_document',
      { document_id: id, approve: false, note, corrected_until: null },
      z.null(),
    ),
  );

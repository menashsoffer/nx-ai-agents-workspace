// The supplier's documents (supplier-portal-spec-he.md 6.5, 7.4): list, upload and record.
import { rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { DOCUMENT_KINDS, type DocumentKind } from '../model/kinds.ts';
import { fileName, uploadFile } from './portal.ts';

const documentSchema = z.object({
  id: z.string(),
  kind: z.enum(DOCUMENT_KINDS),
  status: z.enum(['pending', 'approved', 'rejected']),
  valid_until: z.string(),
  review_note: z.string().nullable(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
  storage_path: z.string(),
});
export type SupplierDocument = z.infer<typeof documentSchema>;

const listSchema = z.object({
  kinds: z.array(z.enum(DOCUMENT_KINDS)),
  documents: z.array(documentSchema),
});
export type DocumentList = z.infer<typeof listSchema>;

export const loadDocuments = (supplierId: string) =>
  rpc('portal_documents', { supplier_id: supplierId }, listSchema);

export interface DocumentInput {
  supplierId: string;
  kind: DocumentKind;
  file: File;
  validUntil: string;
}

/** Uploads the file under the supplier's folder, then records it for the municipality. */
export async function sendDocument(input: DocumentInput, upload: typeof fetch = fetch) {
  const path = `${input.supplierId}/${fileName(input.file, crypto.randomUUID())}`;
  await uploadFile(path, input.file, upload);
  return rpc(
    'portal_save_document',
    {
      document: {
        supplier_id: input.supplierId,
        kind: input.kind,
        storage_path: path,
        valid_until: input.validUntil,
      },
    },
    documentSchema,
  );
}

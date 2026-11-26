// The municipality's approaches to the supplier and its answers (supplier-approaches-spec 5).
// The database checks the deadline, the link and the file; an offer stays sealed until then.
import { rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { fileName, uploadFile } from './portal.ts';
import '../model/approach-reasons.ts';

const answerSchema = z.object({
  id: z.string(),
  answer: z.enum(['offer', 'declined']),
  offer_amount: z.number().nullable(),
  offer_includes_vat: z.boolean().nullable(),
  decline_reason: z.string().nullable(),
  note: z.string().nullable(),
  source: z.enum(['portal', 'staff']),
  withdrawn_at: z.string().nullable(),
  created_at: z.string(),
});

const approachSchema = z.object({
  id: z.string(),
  subject: z.string(),
  unit_name: z.string(),
  approached_on: z.iso.date(),
  respond_by: z.iso.date(),
  needed_by: z.iso.date().nullable(),
  cancelled: z.boolean(),
  open: z.boolean(),
  /** After a winner is chosen: whether this supplier's offer was the one (stage C, 25.11). */
  result: z.enum(['selected', 'not_selected']).nullish(),
  answer: answerSchema.nullable(),
});
export type Approach = z.infer<typeof approachSchema>;
export type ApproachAnswer = z.infer<typeof answerSchema>;

export const loadApproaches = (supplierId: string) =>
  rpc('portal_approaches', { supplier_id: supplierId }, z.array(approachSchema));

export interface OfferInput {
  supplierId: string;
  approachId: string;
  /** As typed: digits with up to two decimals. */
  amount: string;
  includesVat: boolean;
  file: File;
  note: string;
}

/** Uploads the offer file under the approach's folder, then sends the offer. */
export async function sendOffer(input: OfferInput, upload: typeof fetch = fetch) {
  const path = `${input.supplierId}/offers/${input.approachId}/${fileName(input.file, crypto.randomUUID())}`;
  await uploadFile(path, input.file, upload);
  const answer = {
    approach_id: input.approachId,
    answer: 'offer' as const,
    offer_amount: input.amount,
    offer_includes_vat: input.includesVat,
    file_path: path,
    note: input.note,
  };
  await rpc('portal_answer_approach', { answer }, answerSchema);
}

export interface DeclineInput {
  approachId: string;
  reason: string;
  note: string;
}

export async function sendDecline({ approachId, reason, note }: DeclineInput) {
  const answer = {
    approach_id: approachId,
    answer: 'declined' as const,
    decline_reason: reason,
    note,
  };
  await rpc('portal_answer_approach', { answer }, answerSchema);
}

export async function withdrawAnswer(responseId: string) {
  await rpc('portal_withdraw_answer', { response_id: responseId }, z.null());
}

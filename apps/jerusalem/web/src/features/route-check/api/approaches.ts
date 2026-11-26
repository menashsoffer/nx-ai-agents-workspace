// The approaches of a saved request and their answers (supplier-approaches-spec-he.md 6.2).
// The database keeps an offer's amount, note and file out until the deadline has passed.
import { rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { CHANNELS } from '../model/approaches.ts';
import '../model/approach-reasons.ts';
import { savedChanged } from './saved.ts';

const answerSchema = z.object({
  id: z.string(),
  answer: z.enum(['offer', 'declined']),
  decline_reason: z.string().nullable(),
  source: z.enum(['portal', 'staff']),
  received_on: z.string().nullable(),
  created_at: z.string(),
  offer_amount: z.number().nullish(),
  offer_includes_vat: z.boolean().nullish(),
  note: z.string().nullish(),
  file_path: z.string().nullish(),
});

const approachSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  supplier_name: z.string(),
  channel: z.enum(CHANNELS).catch('other'),
  approached_on: z.iso.date(),
  respond_by: z.iso.date().nullable(),
  sealed: z.boolean(),
  answer: answerSchema.nullable(),
});
export type RequestApproach = z.infer<typeof approachSchema>;

export function loadRequestApproaches(request: string): Promise<RequestApproach[]> {
  return rpc('request_approaches', { request_id: request }, z.array(approachSchema));
}

/** An answer that reached staff by email, phone or letter (spec 6.3). */
export interface StaffAnswer {
  approachId: string;
  receivedOn: string;
  note: string;
  offer?: { amount: string; includesVat: boolean };
  declineReason?: string;
}

export async function recordAnswer(input: StaffAnswer): Promise<void> {
  const answer = {
    approach_id: input.approachId,
    received_on: input.receivedOn,
    note: input.note,
    ...(input.offer
      ? {
          answer: 'offer' as const,
          offer_amount: input.offer.amount,
          offer_includes_vat: input.offer.includesVat,
        }
      : { answer: 'declined' as const, decline_reason: input.declineReason ?? 'other' }),
  };
  await rpc('record_approach_answer', { answer }, z.unknown());
}

/** Moves every open deadline of the request forward; returns how many moved. */
export function extendDeadline(request: string, respondBy: string, reason: string) {
  return rpc('extend_approach_deadline', { request, respond_by: respondBy, reason }, z.number());
}

/** Picks the winner and closes the request (stage C, 25.11); the database checks the offer. */
export async function awardRequest(request: string, approach: string, note: string) {
  await rpc('award_engagement_request', { request, approach, note: note.trim() || null }, z.null());
  void savedChanged();
}

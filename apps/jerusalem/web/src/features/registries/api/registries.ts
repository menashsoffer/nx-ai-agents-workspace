// Verifying a registry against its document (stage B, 25.11): the registries this user
// reviews, one registry's suppliers, its "valid until", and one decision per supplier.
import { rpc, requireRoles } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { errorText } from '../../../data/errors.ts';
import { refreshScreen } from '../../../data/screen-data.ts';

export const REVIEWS_KEY = ['registry-reviews'] as const;
export const reviewKey = (version: string) => ['registry-review', version] as const;

const day = z.string().nullable();
const countsSchema = z.object({
  needs_review: z.number(),
  verified: z.number(),
  rejected: z.number(),
  expired: z.number(),
});
const reviewSchema = z.object({
  registry_id: z.string(),
  name: z.string(),
  unit: z.string().nullable(),
  version_id: z.string(),
  document: z.string().nullable(),
  valid_from: day,
  valid_until: day,
  counts: countsSchema,
});
export type RegistryReview = z.infer<typeof reviewSchema>;

const memberSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  supplier: z.string(),
  name_as_published: z.string().nullable(),
  field: z.string().nullable(),
  source_page: z.number().nullable(),
  registered_until: day,
  review_status: z.enum(['needs_review', 'verified', 'rejected']),
  note: z.string().nullable(),
});
export type Member = z.infer<typeof memberSchema>;

const detailSchema = z.object({
  registry_id: z.string(),
  name: z.string(),
  version_id: z.string(),
  document: z.string().nullable(),
  valid_from: day,
  valid_until: day,
  members: z.array(memberSchema),
});
export type RegistryDetail = z.infer<typeof detailSchema>;

export async function loadReviews(): Promise<RegistryReview[]> {
  await requireRoles(['unit_manager']);
  return rpc('registry_reviews', {}, z.array(reviewSchema));
}

export async function loadReview(version: string): Promise<RegistryDetail> {
  await requireRoles(['unit_manager']);
  return rpc('registry_review', { version }, detailSchema);
}

/** Runs a change, refreshes this registry and the list, and returns an error sentence or ''. */
async function changed(version: string, run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return errorText(error);
  }
  await Promise.all([
    refreshScreen(reviewKey(version)).catch(() => undefined),
    refreshScreen(REVIEWS_KEY).catch(() => undefined),
  ]);
  return '';
}

export const saveValidity = (version: string, until: string | null) =>
  changed(version, () => rpc('set_registry_validity', { version, valid_until: until }, z.null()));

export const decideMember = (version: string, decision: { id: string; note: string | null }) =>
  changed(version, () =>
    rpc(
      'decide_membership',
      { membership: decision.id, approve: decision.note === null, note: decision.note },
      z.null(),
    ),
  );

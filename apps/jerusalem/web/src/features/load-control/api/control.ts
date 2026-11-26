import { requireRoles, rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';

const count = z.number().int().nonnegative();
const controlSchema = z.object({
  jobs: z.array(
    z.object({
      job: z.string(),
      status: z.enum(['running', 'ok', 'failed']),
      started_at: z.string(),
      finished_at: z.string().nullable(),
    }),
  ),
  batches: z.array(
    z.object({
      script_name: z.string(),
      status: z.string(),
      row_count: count,
      created_at: z.string(),
      pending: count,
      duplicates: count,
    }),
  ),
  registries: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      memberships: count,
      needs_review: count,
      verified: count,
    }),
  ),
  candidates: z.record(z.string(), count),
  identifiers_pending: count,
  same_names: count,
  venues: count,
});
export type LoadControl = z.infer<typeof controlSchema>;

/** Errors people saw moved to their own screen (error-details-spec-he.md, decision 1). */
export async function loadControl(): Promise<LoadControl> {
  await requireRoles(['admin', 'auditor']);
  return rpc('load_control', {}, controlSchema);
}

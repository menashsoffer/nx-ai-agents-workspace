// Saved engagement requests with the state of their latest route check (screens-spec 2.ב).
import { rows, rpc, permitted, type Identity } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { invalidate } from '../../../data/screen-data.ts';

const requestSchema = z.object({
  id: z.string(),
  unit_id: z.string(),
  subject: z.string(),
  estimated_value: z.number().nonnegative(),
  value_includes_vat: z.boolean(),
  requested_exemption: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
const checkSchema = z.object({
  request_id: z.string(),
  status: z.enum(['ok', 'needs_review', 'blocked']).catch('needs_review'),
  created_at: z.string(),
});

type CheckStatus = 'ok' | 'needs_review' | 'blocked';
export type SavedRequest = z.infer<typeof requestSchema> & {
  lastStatus: CheckStatus | null;
  /** The details changed after the last check, so its answer may no longer hold. */
  changedSinceCheck: boolean;
};
/** The roles that may save requests and check them again; the database enforces it too. */
export const SAVED_ROLES = ['editor', 'unit_manager'] as const;

/** The saved list's key in the screen data (state-management-spec-he.md 5.3). */
export const SAVED_KEY = ['engagement', 'saved'] as const;
/** Every write below marks the list changed, so the page shows it at once. */
export const savedChanged = () => invalidate(SAVED_KEY);

/** Newest first; null for a user who cannot see saved requests. */
export async function loadSaved(who: Identity): Promise<SavedRequest[] | null> {
  if (!permitted(who.access, SAVED_ROLES)) return null;
  const requests = await rows(
    'engagement_requests',
    { status: 'not.in.(cancelled,rejected,contracted)', order: 'created_at.desc' },
    z.array(requestSchema),
  );
  if (!requests.length) return [];
  const checks = await rows(
    'route_checks',
    { request_id: `in.(${requests.map((r) => r.id).join(',')})`, order: 'created_at.desc' },
    z.array(checkSchema),
  );
  const latest = new Map<string, z.infer<typeof checkSchema>>();
  for (const check of checks)
    if (!latest.has(check.request_id)) latest.set(check.request_id, check);
  return requests.map((request) => {
    const last = latest.get(request.id);
    return {
      ...request,
      lastStatus: last?.status ?? null,
      changedSinceCheck:
        last !== undefined && Date.parse(request.updated_at) > Date.parse(last.created_at),
    };
  });
}

export interface RequestDetails {
  subject: string;
  estimated_value: number;
  value_includes_vat: boolean;
  requested_exemption: string | null;
}

/** Runs as the signed-in user; the database refuses a closed request or another unit's. */
export async function updateRequest(request: string, draft: RequestDetails): Promise<void> {
  await rpc('update_engagement_request', { request, draft }, z.null());
  void savedChanged();
}

/** A request is never deleted: it is cancelled with a reason and leaves the list. */
export async function cancelRequest(request: string, note: string): Promise<void> {
  await rpc('cancel_engagement_request', { request, note }, z.null());
  void savedChanged();
}

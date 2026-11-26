import { rows, rpc, requireRoles } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { candidateSchema } from '../model/candidate.ts';
import { kindSuggestionSchema } from '../model/kinds.ts';
/** The screen's key in the screen data (state-management-spec-he.md 5.3). */
export const CANDIDATES_KEY = ['identifier-candidates'] as const;
export async function loadCandidates() {
  await requireRoles(['admin']);
  const [candidates, kinds, suppliers] = await Promise.all([
    rows('identifier_candidates', { status: 'eq.pending' }, z.array(candidateSchema)),
    rows('kind_suggestions', { status: 'eq.pending' }, z.array(kindSuggestionSchema)),
    rows(
      'suppliers',
      { status: 'neq.merged' },
      z.array(z.object({ id: z.string(), display_name: z.string() })),
    ),
  ]);
  return { candidates, kinds, suppliers };
}
export async function decideCandidate(id: string, accept: boolean): Promise<void> {
  await rpc('decide_identifier_candidate', { candidate: id, accept }, z.string().nullable());
}

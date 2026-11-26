// error-details-spec-he.md section 4: every error people saw, administrators only.
import { requireRoles, rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { groupCases, type ErrorGroup } from '../model/groups.ts';
import { viewOf, type ErrorView } from '../model/period.ts';

const text = z.string().nullable();
const caseSchema = z.object({
  id: z.coerce.number().int(),
  created_at: z.string(),
  kind: z.string(),
  screen: z.string(),
  cause: z.string(),
  request: text,
  error_code: text,
  boundary: text,
  role: text,
  device: text,
  site_version: text,
});

export interface ErrorsData {
  view: ErrorView;
  total: number;
  groups: ErrorGroup[];
}

export async function loadErrors({ request }: { request: Request }): Promise<ErrorsData> {
  await requireRoles(['admin']);
  const view = viewOf(new URL(request.url).searchParams);
  const cases = await rpc('error_cases', { days: view.period.days }, z.array(caseSchema));
  const groups = groupCases(cases);
  return { view, total: cases.length, groups: groups.filter((g) => g.urgent || !view.urgentOnly) };
}

// The admin usage dashboard reads one summary function (usage-analytics-spec-he.md 4.3).
import { requireRoles, rpc } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { israelToday } from '../../../lib/dates.ts';
import { rangeOf, type Range } from '../model/range.ts';

const count = z.coerce.number().int().nonnegative();
const sum = count.nullable().transform((value) => value ?? 0);
const summarySchema = z.object({
  days: z.array(z.object({ day: z.string(), role: z.string(), visitors: count, visits: count })),
  screens: z.array(z.object({ screen: z.string(), views: sum, exits: sum, total_ms: sum })),
  actions: z.array(z.object({ screen: z.string(), action: z.string(), count })),
  steps: z.array(z.object({ screen: z.string(), step: count, visits: count })),
  visit_ms: count,
  ended_visits: count,
});
export type UsageSummary = z.infer<typeof summarySchema>;
export interface UsageData {
  range: Range;
  summary: UsageSummary;
}

export async function loadUsage({ request }: { request: Request }): Promise<UsageData> {
  await requireRoles(['admin']);
  const range = rangeOf(new URL(request.url).searchParams, israelToday());
  const summary = await rpc(
    'usage_summary',
    { from_day: range.from, to_day: range.to, only_role: range.role },
    summarySchema,
  );
  return { range, summary };
}

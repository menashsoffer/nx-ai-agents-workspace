import { rows, rpc, requireRoles } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { requestSchema, parseDecision, type DecisionField } from '../model/decision.ts';
import { errorText } from '../../../data/errors.ts';
import { DataError } from '../../../data/client.ts';
import { refreshScreen } from '../../../data/screen-data.ts';
/** The screen's key in the screen data (state-management-spec-he.md 5.3). */
export const CATEGORY_REQUESTS_KEY = ['category-requests'] as const;
const refresh = () => refreshScreen(CATEGORY_REQUESTS_KEY);
export async function loadRequests() {
  const who = await requireRoles(['admin']);
  const [requests, categories] = await Promise.all([
    rows('category_requests', { status: 'eq.pending' }, z.array(requestSchema)),
    rows(
      'categories',
      { active: 'eq.true' },
      z.array(z.object({ id: z.string(), name: z.string() })),
    ),
  ]);
  return { requests, categories, userId: who.userId };
}

export interface DecisionState {
  /** A problem with the whole decision, shown at the top of the dialog. */
  error: string;
  /** A problem with one field, shown under it. */
  field: Partial<Record<DecisionField, string>>;
  committed: boolean;
}
export const INITIAL_DECISION: DecisionState = { error: '', field: {}, committed: false };

function failure(error: unknown): DecisionState {
  return {
    ...INITIAL_DECISION,
    error: errorText(error),
  };
}

export async function decideRequest(id: string, form: FormData): Promise<DecisionState> {
  const decision = parseDecision(form);
  if ('error' in decision)
    return { ...INITIAL_DECISION, field: { [decision.field]: decision.error } };
  try {
    await rpc('decide_category_request', { request_id: id, ...decision }, z.string().nullable());
  } catch (error) {
    // 404: another administrator already decided the request.
    if (error instanceof DataError && error.status === 404) {
      await refresh().catch(() => undefined);
      return { ...INITIAL_DECISION, error: 'הבקשה כבר טופלה. הרשימה רועננה.' };
    }
    return failure(error);
  }
  try {
    await refresh();
  } catch {
    return {
      ...INITIAL_DECISION,
      error: 'ההחלטה נשמרה. יש לרענן את הרשימה לפני פעולה נוספת.',
      committed: true,
    };
  }
  return { ...INITIAL_DECISION, committed: true };
}

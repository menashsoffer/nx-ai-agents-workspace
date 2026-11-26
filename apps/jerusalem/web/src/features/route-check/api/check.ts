import { freshToken, recoverSession } from '../../../data/rpc.ts';
import { DataError, REQUEST_TIMEOUT_MS, refusal, unanswered } from '../../../data/client.ts';
import { REASON_MESSAGES } from '../../../lib/errors/reasons.ts';
import { kindOfStatus, type FailureKind } from '../../../lib/errors/failure.ts';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../../../data/environment.ts';
import { checkInputSchema, resultSchema, type CheckInput } from '../model/result.ts';
import { savedChanged } from './saved.ts';
/** Messages the route check owns, for answers that mean more here than in general. */
const NOT_FOUND = 'הבקשה כבר לא קיימת או שאינה ביחידה שלך. רעננו את רשימת הבקשות השמורות.';
/** The function says "Database unavailable" when it could not reach the database. */
const DATABASE_DOWN = 'Database unavailable';

function kindOf(status: number, message: string): FailureKind {
  if (status === 422) return 'reason';
  if (status === 502 && message !== DATABASE_DOWN) return 'system';
  return kindOfStatus(status);
}

/** `reason:<key>` from the function wins; a 422 from an older deployment means the same. */
function checkError(status: number, message: string): DataError {
  const error = refusal(status, message, kindOf(status, message));
  if (error.kind === 'reason' && !message.startsWith('reason:')) {
    error.message = REASON_MESSAGES.no_thresholds;
  }
  if (status === 404) error.message = NOT_FOUND;
  return error;
}

async function failed(response: Response): Promise<DataError> {
  let message = '';
  try {
    const body = (await response.json()) as { error?: unknown };
    message = typeof body.error === 'string' ? body.error : '';
  } catch {
    /* An empty or broken body keeps the status alone. */
  }
  return checkError(response.status, message);
}

export async function checkRoute(input: CheckInput, fetcher: typeof fetch = fetch) {
  const body = checkInputSchema.parse(input);
  const token = await freshToken();
  let response: Response;
  try {
    response = await fetcher(`${SUPABASE_URL}/functions/v1/route-check`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw unanswered(error);
  }
  // Renews the session for the next try, or signs out when it cannot be renewed.
  if (response.status === 401) await recoverSession(token).catch(() => null);
  if (!response.ok) throw await failed(response);
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new DataError(0);
  }
  const result = resultSchema.safeParse(raw);
  if (!result.success) throw new DataError(0);
  // A saved request's check is stored, and the saved list shows its latest result.
  if ('request_id' in body) void savedChanged();
  return result.data;
}

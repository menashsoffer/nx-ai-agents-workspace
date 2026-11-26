import { freshToken } from '../../../data/rpc.ts';
import { REQUEST_TIMEOUT_MS } from '../../../data/client.ts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../../data/environment.ts';

/**
 * Asks the server to check the supplier's numbers in the Companies Registrar and GuideStar
 * before a name or kind change is checked (spec 6.3). The server stores what the registries
 * said, and the database checks read it. A failure is ignored: the checks then run on what
 * is already stored, and say so when no registry answer exists.
 */
export async function refreshRegistry(supplierId: string, fetcher: typeof fetch = fetch) {
  try {
    const token = await freshToken();
    await fetcher(`${SUPABASE_URL}/functions/v1/supplier-change-check`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ supplier_id: supplierId }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    /* The registry is a help, not a gate. */
  }
}

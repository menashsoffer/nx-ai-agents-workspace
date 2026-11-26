import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../../data/environment.ts';

/**
 * Asks the server to check new or changed addresses on the map now, instead of at the
 * next hourly run (spec 4.6). The answer is not awaited: the save has already succeeded,
 * and the function itself skips a run that starts too soon after the previous one.
 */
export function requestAddressCheck(fetcher: typeof fetch = fetch): void {
  fetcher(`${SUPABASE_URL}/functions/v1/address-check`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    keepalive: true,
  }).catch(() => undefined);
}

// Files in the private supplier-documents bucket. Storage policies decide who may read which
// file; a refused path fails like any other request.
import { freshToken } from './rpc.ts';
import { z } from './zod.ts';
import { failedResponse } from './client.ts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './environment.ts';

const signedSchema = z.object({ signedURL: z.string() });

/** A link to a supplier file that works for 5 minutes (the bucket is private). */
export async function signedFileUrl(path: string, send: typeof fetch = fetch): Promise<string> {
  const response = await send(`${SUPABASE_URL}/storage/v1/object/sign/supplier-documents/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${await freshToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 300 }),
  });
  if (!response.ok) throw await failedResponse(response);
  const { signedURL } = signedSchema.parse(await response.json());
  return `${SUPABASE_URL}/storage/v1${signedURL}`;
}

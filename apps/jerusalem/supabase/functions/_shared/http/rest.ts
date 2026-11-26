import type { ServerEnv } from './env.ts';

// One PostgREST call with a short timeout. `as` picks the credentials: the
// caller's token (RLS and grants apply) or the secret key (function-only writes).

export interface RestCall {
  readonly path: string;
  readonly body: unknown;
  readonly as: { readonly token: string } | 'service';
}

export interface RestResult {
  readonly status: number;
  readonly body: unknown;
}

const TIMEOUT_MS = 8000;

function headers(env: ServerEnv, as: RestCall['as']): Record<string, string> {
  const key = as === 'service' ? env.secretKey : env.publicKey;
  return {
    apikey: key,
    Authorization: `Bearer ${as === 'service' ? key : as.token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

export async function rest(
  env: ServerEnv,
  call: RestCall,
  fetcher: typeof fetch,
): Promise<RestResult> {
  try {
    const response = await fetcher(`${env.url}/rest/v1/${call.path}`, {
      method: 'POST',
      headers: headers(env, call.as),
      body: JSON.stringify(call.body),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  } catch {
    return { status: 503, body: null };
  }
}

/** The status to pass on for a failed call: PostgREST's own for PTxxx errors, else 502. */
export function failedStatus(result: RestResult): number {
  return [401, 403, 404, 429].includes(result.status) ? result.status : 502;
}

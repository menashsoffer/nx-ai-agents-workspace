// Supabase settings that the Edge Runtime injects. New projects expose the API
// keys as JSON maps (SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS); older ones
// as SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Both are accepted.

export interface ServerEnv {
  readonly url: string;
  /** Public key: requests made with the caller's own token. */
  readonly publicKey: string;
  /** Secret key: writes that only the function may make. Never sent to the browser. */
  readonly secretKey: string;
}

export type ReadEnv = (name: string) => string | undefined;

function firstKey(map: string | undefined): string | undefined {
  if (!map) return undefined;
  try {
    const keys = JSON.parse(map) as Record<string, unknown>;
    const key = keys.default ?? Object.values(keys)[0];
    return typeof key === 'string' && key !== '' ? key : undefined;
  } catch {
    return undefined;
  }
}

export function serverEnv(read: ReadEnv): ServerEnv | null {
  const url = read('SUPABASE_URL');
  const publicKey = firstKey(read('SUPABASE_PUBLISHABLE_KEYS')) ?? read('SUPABASE_ANON_KEY');
  const secretKey = firstKey(read('SUPABASE_SECRET_KEYS')) ?? read('SUPABASE_SERVICE_ROLE_KEY');
  return url && publicKey && secretKey ? { url, publicKey, secretKey } : null;
}

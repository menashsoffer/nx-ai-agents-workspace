// Which Supabase project the site talks to. A build for staging or a local database sets
// VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example); otherwise the
// production project is used. Only the public key belongs here, never a secret one.
type ViteEnv = Partial<Record<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY', string>>;

const PRODUCTION_URL = 'https://jzsvhjkiklfnogseelbe.supabase.co';
const PRODUCTION_KEY = 'sb_publishable_XgkUnokIil-H5Qy4_VAN0A_VIUA2wwq';

// Vite replaces import.meta.env at build time; under Node it is undefined.
const env: ViteEnv = (import.meta as ImportMeta & { env?: ViteEnv }).env ?? {};

/** An unset or empty value (as .env.example leaves it) falls back to production. */
export function setting(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

export const SUPABASE_URL = setting(env.VITE_SUPABASE_URL, PRODUCTION_URL);
export const SUPABASE_PUBLISHABLE_KEY = setting(env.VITE_SUPABASE_PUBLISHABLE_KEY, PRODUCTION_KEY);

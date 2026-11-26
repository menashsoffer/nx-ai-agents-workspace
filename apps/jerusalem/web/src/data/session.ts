/* Browser sign-in state: the session tokens, the PKCE verifier and errors returned by Supabase.
   The session lives in localStorage, so closing the browser does not sign the user out. */
export const SESSION_KEY = 'consultants-session-v2';
export const PKCE_KEY = 'consultants-pkce-v1';

export interface Session {
  token: string;
  exp: number;
  /** Trades for a new access token when `token` expires; null for an old session without one. */
  refresh: string | null;
}
/** What Supabase returns for a sign-in or a refresh, already parsed. */
export interface Grant {
  token: string;
  expiresIn: number;
  refresh: string | null;
}
export interface BrowserContext {
  location: Pick<Location, 'href' | 'pathname' | 'search' | 'hash'>;
  history: Pick<History, 'replaceState'>;
  storage: Storage;
}
type Exchange = (code: string, verifier: string) => Promise<Response>;

const EXPIRED_CODES = new Set(['bad_oauth_state', 'flow_state_expired', 'otp_expired']);
export const EXPIRED_MESSAGE = 'תוקף ניסיון ההתחברות פג. יש להתחיל התחברות חדשה.';
export const FAILED_MESSAGE = 'ההתחברות לא הושלמה. יש להתחיל מחדש או לפנות למנהל המערכת.';

function replaceUrl(ctx: BrowserContext, url: URL): void {
  ctx.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** Removes an authentication error from the address and returns a message to show. */
export function takeAuthError(ctx: BrowserContext): string {
  const url = new URL(ctx.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const error = url.searchParams.get('error') ?? fragment.get('error');
  const code = url.searchParams.get('error_code') ?? fragment.get('error_code') ?? '';
  if (!error && !code) return '';
  for (const key of ['error', 'error_code', 'error_description']) {
    url.searchParams.delete(key);
    fragment.delete(key);
  }
  url.hash = fragment.toString();
  replaceUrl(ctx, url);
  ctx.storage.removeItem(PKCE_KEY);
  return EXPIRED_CODES.has(code) ? EXPIRED_MESSAGE : FAILED_MESSAGE;
}

export function sessionFrom(grant: Grant, now = Date.now()): Session {
  return { token: grant.token, exp: now + grant.expiresIn * 1000, refresh: grant.refresh };
}

export function storeSession(storage: Storage, grant: Grant): Session {
  const session = sessionFrom(grant);
  storage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

/** Reads a Supabase token response; null when it is not a usable session. */
export function parseGrant(value: unknown): Grant | null {
  const data = (value ?? {}) as Record<string, unknown>;
  const { access_token: token, expires_in: expiresIn, refresh_token: refresh } = data;
  if (typeof token !== 'string' || !token || !Number(expiresIn)) return null;
  return {
    token,
    expiresIn: Number(expiresIn),
    refresh: typeof refresh === 'string' && refresh ? refresh : null,
  };
}

function storedFields(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A stored session, kept after its access token expires as long as it can be refreshed. */
export function parseSession(raw: string | null, now = Date.now()): Session | null {
  const fields = raw ? storedFields(raw) : null;
  if (!fields) return null;
  const { token, exp, refresh } = fields;
  if (typeof token !== 'string' || typeof exp !== 'number') return null;
  const renewable = typeof refresh === 'string' && refresh !== '' ? refresh : null;
  return exp > now || renewable ? { token, exp, refresh: renewable } : null;
}

/** Keeps a token from a magic-link redirect, then returns the stored session if still valid. */
export function takeSession(ctx: BrowserContext): Session | null {
  const params = new URLSearchParams(ctx.location.hash.slice(1));
  const token = params.get('access_token');
  if (token) {
    const refresh = params.get('refresh_token');
    storeSession(ctx.storage, {
      token,
      expiresIn: Number(params.get('expires_in')) || 3600,
      refresh,
    });
    ctx.history.replaceState(null, '', ctx.location.pathname + ctx.location.search);
  }
  return parseSession(ctx.storage.getItem(SESSION_KEY));
}

type ToBase64 = (options: { alphabet: 'base64url'; omitPadding: boolean }) => string;

/** URL-safe base64 without padding, as PKCE requires. Uses the built-in encoder where present. */
export function base64Url(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: ToBase64 }).toBase64;
  if (typeof native === 'function')
    return native.call(bytes, { alphabet: 'base64url', omitPadding: true });
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Creates a PKCE verifier, keeps it for the redirect back, and returns the authorize URL. */
export async function googleAuthorizeUrl(
  ctx: BrowserContext,
  base: string,
  redirect: string,
): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  ctx.storage.setItem(PKCE_KEY, verifier);
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: redirect,
    code_challenge: base64Url(new Uint8Array(hash)),
    code_challenge_method: 's256',
  });
  return `${base}/auth/v1/authorize?${params}`;
}

/** Trades an OAuth code in the address for a session. Does nothing without a code. */
export async function exchangeGoogleCode(ctx: BrowserContext, exchange: Exchange): Promise<void> {
  const url = new URL(ctx.location.href);
  const code = url.searchParams.get('code');
  if (!code) return;
  url.searchParams.delete('code');
  replaceUrl(ctx, url);
  const verifier = ctx.storage.getItem(PKCE_KEY);
  ctx.storage.removeItem(PKCE_KEY);
  if (!verifier) throw new Error('missing verifier');
  const response = await exchange(code, verifier);
  if (!response.ok) throw new Error('exchange failed');
  const grant = parseGrant(await response.json());
  if (!grant) throw new Error('invalid session');
  storeSession(ctx.storage, grant);
}

const NEXT_KEY = 'consultants-next-v1';

/** Only a path inside this site, so a crafted link cannot send the user elsewhere. */
function safePath(path: string | null): string | null {
  return path?.startsWith('/') && !path.startsWith('//') ? path : null;
}

/** Remembers the screen to return to after a sign-in that leaves the site (Google, email). */
export function rememberNext(storage: Storage, path: string | null): void {
  const safe = safePath(path);
  if (safe) storage.setItem(NEXT_KEY, safe);
  else storage.removeItem(NEXT_KEY);
}

export function takeNext(storage: Storage): string | null {
  const path = safePath(storage.getItem(NEXT_KEY));
  storage.removeItem(NEXT_KEY);
  return path;
}

export { safePath };

/** The `next` screen in a hash address such as `#/auth?next=%2Fusers`. */
export function nextFromHash(hash: string): string | null {
  const query = hash.split('?')[1] ?? '';
  return safePath(new URLSearchParams(query).get('next'));
}

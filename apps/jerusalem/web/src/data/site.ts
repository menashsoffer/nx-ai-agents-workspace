import { supplierDetail, type SupplierDetail } from './supplier-detail.ts';
import { loadWriteContext, writableVersions, type WriteContext } from './write-context.ts';
import { DataClient, REQUEST_TIMEOUT_MS } from './client.ts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './environment.ts';
import type { EventRequest } from '../lib/tracker.ts';
import { IndexedCatalogCache } from './catalog-cache.ts';
import { SnapshotLoader, tokenUserId, type CatalogState } from './snapshot.ts';
import { clearScreenData } from './screen-data.ts';

export const BASE = SUPABASE_URL;
const PUBLIC_KEY = SUPABASE_PUBLISHABLE_KEY;

type Unauthorized = (token: string) => Promise<void>;
let unauthorized: Unauthorized = () => clearCatalog();
/** What a 401 for the catalog's own token does: by default it forgets the catalog. */
export function setUnauthorizedHandler(handler: Unauthorized): void {
  unauthorized = handler;
}

export function data(token: string): DataClient {
  return new DataClient({
    baseUrl: BASE,
    publicKey: PUBLIC_KEY,
    token,
    onUnauthorized: () =>
      currentToken && sameUser(currentToken, token) ? unauthorized(token) : Promise.resolve(),
  });
}

function authHeaders(token?: string): Record<string, string> {
  return {
    apikey: PUBLIC_KEY,
    Authorization: `Bearer ${token ?? PUBLIC_KEY}`,
    'Content-Type': 'application/json',
  };
}

export function exchangeCode(code: string, verifier: string): Promise<Response> {
  return fetch(`${BASE}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Trades a refresh token for a new access token (and a new refresh token). */
export function refreshGrant(refreshToken: string): Promise<Response> {
  return fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Ends this browser's session on the server, so its refresh token stops working. */
export function logout(token: string): Promise<Response> {
  return fetch(`${BASE}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: authHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** The signed-in account as Supabase Auth keeps it (for its last sign-in time). */
export function authUser(token: string): Promise<Response> {
  return fetch(`${BASE}/auth/v1/user`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export function sendLink(email: string, redirect: string): Promise<Response> {
  return fetch(`${BASE}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, create_user: false }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

const loader = new SnapshotLoader(new IndexedCatalogCache(BASE));
let currentToken: string | null = null;
type Listener = (state: CatalogState | null) => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publishState(state: CatalogState | null): void {
  for (const listener of listeners) listener(state);
}

/** The same token, or a renewed one for the same signed-in user. */
function sameUser(a: string, b: string): boolean {
  const id = tokenUserId(a);
  return a === b || (id !== null && id === tokenUserId(b));
}

export async function loadSnapshot(
  token: string,
  publish: (state: CatalogState) => void = () => undefined,
  onRequest: () => void = () => undefined,
): Promise<CatalogState> {
  // A renewed token for the same user keeps the cache; another user's does not.
  if (currentToken && !sameUser(currentToken, token)) await loader.clear();
  currentToken = token;
  return loader.load(data(token), token, {
    publish: (state) => {
      publishState(state);
      publish(state);
    },
    onRequest,
  });
}

/** `notify: false` clears silently, for a sign-out that reloads the page right after. */
export async function clearCatalog(userId?: string, notify = true): Promise<void> {
  const id = userId ?? tokenUserId(currentToken ?? '') ?? undefined;
  currentToken = null;
  // Screen data belongs to the person who loaded it, like the catalog.
  clearScreenData();
  const clearing = loader.clear(id);
  if (notify) publishState(null);
  await clearing;
}

/** A card opened while the cached catalog is revalidating waits for server access. */
async function confirmed(token: string) {
  const state = await loader.settled();
  const current = currentToken !== null && sameUser(currentToken, token);
  if (!state?.access || !state.catalog || !current) throw new Error('יש להתחבר מחדש.');
  return { ...state, access: state.access, catalog: state.catalog };
}

/** Stable object reference between publications, for React external-store readers. */
export function getCatalogState(): CatalogState | null {
  return loader.state;
}

export function getAccess() {
  return loader.state?.access ?? null;
}

export async function catalog(token: string) {
  return (await loadSnapshot(token)).suppliers;
}

export async function detail(token: string, supplierId: string): Promise<SupplierDetail> {
  const state = await confirmed(token);
  return supplierDetail(data(token), state.catalog, supplierId);
}

export function canAddSupplier(): boolean {
  const state = loader.state;
  return (
    !!state?.access && !!state.catalog && writableVersions(state.catalog, state.access).length > 0
  );
}

export async function writeContext(token: string): Promise<WriteContext> {
  const state = await confirmed(token);
  return loadWriteContext(data(token), state.catalog, state.access);
}

export function saveMembership(token: string, payload: Record<string, string>): Promise<string> {
  return data(token).supplierWrite('save_supplier_membership', payload);
}

/** A batch of monitoring or usage events, sent to a function that checks every field. */
export function eventRpcRequest(name: string, token: string, events: unknown[]): EventRequest {
  return {
    url: `${BASE}/rest/v1/rpc/${name}`,
    init: { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ events }) },
  };
}

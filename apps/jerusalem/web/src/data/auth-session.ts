/* Keeps the user signed in: the session survives closing the browser, and the short-lived
   access token is traded for a new one with the refresh token before it expires. */
import { DataError } from './client.ts';
import { SESSION_KEY, parseGrant, parseSession, sessionFrom, type Session } from './session.ts';

/** Renew this long before the access token expires, so a request never carries a stale one. */
export const REFRESH_MARGIN_MS = 120_000;
/** Supabase answers these when the refresh token is used up or revoked: the user must sign in. */
const REJECTED = new Set([400, 401, 403]);
const LOCK_NAME = 'consultants-session-refresh';
const MAX_DELAY_MS = 2 ** 31 - 1;

type Refresh = (refreshToken: string) => Promise<Response>;
type Locks = Pick<LockManager, 'request'>;
export interface KeeperOptions {
  storage: Storage;
  refresh: Refresh;
  /** Serializes renewal between tabs, since a refresh token can be spent only once. */
  locks?: Locks | undefined;
  now?: () => number;
}

export class SessionKeeper {
  private readonly options: KeeperOptions;
  private session: Session | null;
  private pending: Promise<Session | null> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private auto = false;
  private readonly listeners = new Set<() => void>();

  constructor(options: KeeperOptions) {
    this.options = options;
    this.session = this.stored();
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private stored(): Session | null {
    return parseSession(this.options.storage.getItem(SESSION_KEY), this.now());
  }

  /** The stored session, possibly with an expired access token that can still be renewed. */
  current(): Session | null {
    return this.session;
  }

  /** Keeps a session from sign-in or renewal, or forgets it when given null. */
  adopt(session: Session | null): void {
    const storage = this.options.storage;
    if (session) storage.setItem(SESSION_KEY, JSON.stringify(session));
    else storage.removeItem(SESSION_KEY);
    this.session = session;
    this.schedule();
  }

  /** Picks up a sign-in, renewal or sign-out made in another tab. */
  reload(): void {
    const had = this.session !== null;
    this.session = this.stored();
    this.schedule();
    if (had && !this.session) this.end(true);
  }

  /** Renews the access token on a timer from now on (the browser entry only). */
  start(): void {
    this.auto = true;
    this.schedule();
  }

  onSignedOut(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A session whose access token is good for a while, renewing it first when needed. */
  async fresh(): Promise<Session | null> {
    const session = this.session;
    if (!session) return null;
    if (session.exp - this.now() > REFRESH_MARGIN_MS) return session;
    return this.renew(session.token, false);
  }

  /** After the server rejected `failedToken`: a newer session, or null once signed out. */
  recover(failedToken: string): Promise<Session | null> {
    return this.renew(failedToken, true);
  }

  /** Forgets the session for a sign-out the user asked for; the page reloads right after. */
  clear(): void {
    this.end(false);
  }

  private end(notify: boolean): void {
    this.options.storage.removeItem(SESSION_KEY);
    this.session = null;
    clearTimeout(this.timer);
    if (notify) for (const listener of this.listeners) listener();
  }

  /** `rejected`: the server refused `stale`, so it is not used again even if not yet expired. */
  private renew(stale: string, rejected: boolean): Promise<Session | null> {
    if (this.pending) return this.pending;
    const run = () => this.exchange(stale, rejected);
    const locks = this.options.locks;
    const locked = async (): Promise<Session | null> =>
      locks ? await locks.request(LOCK_NAME, run) : run();
    const pending = locked();
    const shared = pending.finally(() => {
      this.pending = null;
    });
    this.pending = shared;
    return shared;
  }

  private async exchange(stale: string, rejected: boolean): Promise<Session | null> {
    const stored = this.stored();
    if (stored && stored.token !== stale && stored.exp - this.now() > REFRESH_MARGIN_MS) {
      this.adopt(stored);
      return stored;
    }
    const refresh = stored?.refresh;
    if (!refresh) {
      // Without a refresh token the access token is used until it expires.
      if (!rejected && stored && stored.exp > this.now()) return stored;
      this.end(this.session !== null);
      return null;
    }
    const session = await this.request(refresh);
    if (session) this.adopt(session);
    else this.end(true);
    return session;
  }

  /** The renewed session; null when the refresh token was refused; throws when offline. */
  private async request(refresh: string): Promise<Session | null> {
    let response: Response;
    try {
      response = await this.options.refresh(refresh);
    } catch {
      throw new DataError(0);
    }
    if (REJECTED.has(response.status)) return null;
    if (!response.ok) throw new DataError(response.status);
    const grant = parseGrant(await response.json().catch(() => null));
    return grant ? sessionFrom(grant, this.now()) : null;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    const session = this.session;
    if (!this.auto || !session?.refresh) return;
    const delay = Math.max(0, session.exp - REFRESH_MARGIN_MS - this.now());
    this.timer = setTimeout(
      () => {
        this.fresh().catch(() => undefined);
      },
      Math.min(delay, MAX_DELAY_MS),
    );
  }
}

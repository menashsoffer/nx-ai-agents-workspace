import { parseAccess, type Access } from './access.ts';
import { buildCatalog, type Supplier } from '../catalog-model.ts';
import type { CatalogData } from './catalog.ts';
import type { CatalogCache, CacheEntry } from './catalog-cache.ts';
import { compactCatalog } from './compact-catalog.ts';
import { DataError, type DataClient } from './client.ts';
import { object, text } from './parse.ts';
import { beginTiming, type LoadTimings } from './catalog-timing.ts';

export interface CatalogState {
  userId: string;
  version: string;
  access: Access | null;
  catalog: CatalogData | null;
  suppliers: Supplier[];
  refreshing: boolean;
  timings: LoadTimings;
}
type Publish = (state: CatalogState) => void;
export interface LoadOptions {
  publish?: Publish;
  onRequest?: () => void;
}

function tokenClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? '';
  const raw: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  return object(raw);
}

/** The signed-in address, only to show in the account menu; never used for access. */
export function tokenEmail(token: string): string | null {
  try {
    const email = tokenClaims(token).email;
    return typeof email === 'string' && email ? email : null;
  } catch {
    return null;
  }
}

/** The token subject only partitions the cache; server access remains authoritative. */
export function tokenUserId(token: string): string | null {
  try {
    const sub = tokenClaims(token).sub;
    return typeof sub === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sub)
      ? sub
      : null;
  } catch {
    return null;
  }
}

function verifiedUserId(value: unknown, expected: string | null): string {
  const userId = text(value);
  if (expected && expected !== userId) throw new DataError(401);
  return userId;
}

export class SnapshotLoader {
  private readonly cache: CatalogCache;
  private current: CatalogState | null = null;
  private wire: CacheEntry | null = null;
  private generation = 0;
  private storage: Promise<void> = Promise.resolve();
  private inflight: Promise<CatalogState> | null = null;

  constructor(cache: CatalogCache) {
    this.cache = cache;
  }

  get state(): CatalogState | null {
    return this.current;
  }

  /** The server-confirmed state: waits for a pending refresh before reporting. */
  async settled(): Promise<CatalogState | null> {
    const pending = this.inflight;
    if (pending) await pending.catch(() => undefined);
    return this.current?.access ? this.current : null;
  }

  async clear(userId = this.current?.userId): Promise<void> {
    ++this.generation;
    this.inflight = null;
    this.current = null;
    this.wire = null;
    if (userId) await this.persist(() => this.cache.remove(userId));
  }

  private persist(action: () => Promise<void>): Promise<void> {
    this.storage = this.storage.then(action).catch(() => undefined);
    return this.storage;
  }

  private model(entry: CacheEntry, userId: string): CatalogState {
    const end = beginTiming('model');
    const catalog = compactCatalog(entry.catalog);
    const suppliers = buildCatalog(catalog);
    return {
      userId,
      version: entry.version,
      catalog,
      suppliers,
      access: null,
      refreshing: true,
      timings: { request_ms: '0', model_ms: end().toFixed(2) },
    };
  }

  private async cached(userId: string | null): Promise<CatalogState | null> {
    if (!userId) return null;
    if (this.current?.userId === userId && this.wire)
      return { ...this.current, timings: { request_ms: '0', model_ms: '0' } };
    const entry = await this.cache.read(userId);
    if (!entry) return null;
    try {
      const state = this.model(entry, userId);
      this.wire = entry;
      return state;
    } catch {
      await this.cache.remove(userId);
      return null;
    }
  }

  load(client: DataClient, token: string, options: LoadOptions = {}): Promise<CatalogState> {
    const pending = this.fetch(client, token, options);
    this.inflight = pending;
    const done = () => {
      if (this.inflight === pending) this.inflight = null;
    };
    pending.then(done, done);
    return pending;
  }

  private async fetch(client: DataClient, token: string, options: LoadOptions) {
    const publish = options.publish ?? (() => undefined);
    const generation = ++this.generation;
    const userId = tokenUserId(token);
    const cached = await this.cached(userId);
    this.assertCurrent(generation);
    try {
      const pending = this.request(client, {
        version: cached?.version ?? null,
        onRequest: options.onRequest,
      });
      if (cached) {
        this.current = { ...cached, refreshing: true };
        publish(this.current);
      }
      const { raw, requestMs } = await pending;
      this.assertCurrent(generation);
      const authoritativeId = verifiedUserId(raw.user_id, userId);
      const state = await this.accept(raw, { userId: authoritativeId, cached, requestMs, publish });
      this.assertCurrent(generation);
      return state;
    } catch (error) {
      await this.failed(error, { generation, userId });
      throw error;
    }
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw Object.assign(new DataError(0), { superseded: true });
  }

  private async failed(error: unknown, context: { generation: number; userId: string | null }) {
    if (context.generation !== this.generation) return;
    if (error instanceof DataError && error.status === 401)
      await this.clear(context.userId ?? undefined);
  }

  private async request(
    client: DataClient,
    options: { version: string | null; onRequest: (() => void) | undefined },
  ) {
    const end = beginTiming('request');
    let duration: string;
    let response: unknown;
    try {
      const pending = client.rpc('catalog_snapshot', { known_version: options.version });
      options.onRequest?.();
      response = await pending;
    } finally {
      duration = end().toFixed(2);
    }
    return { raw: object(response), requestMs: duration };
  }

  private async accept(
    raw: Record<string, unknown>,
    context: {
      userId: string;
      cached: CatalogState | null;
      requestMs: string;
      publish: Publish;
    },
  ): Promise<CatalogState> {
    const { userId, cached, requestMs, publish } = context;
    const access = parseAccess(raw.access);
    const version = text(raw.version);
    let state: CatalogState;
    let entry: CacheEntry | null = null;
    if (access.state !== 'active' || !access.member) {
      state = {
        userId,
        version,
        access,
        catalog: null,
        suppliers: [],
        refreshing: false,
        timings: { request_ms: requestMs, model_ms: '0' },
      };
    } else if (raw.unchanged === true) {
      if (cached?.version !== version) throw new DataError(0);
      state = {
        ...cached,
        access,
        refreshing: false,
        timings: { ...cached.timings, request_ms: requestMs },
      };
    } else {
      entry = { version, catalog: raw.catalog };
      state = { ...this.model(entry, userId), access, refreshing: false };
      state.timings.request_ms = requestMs;
    }
    const storing = this.store(userId, entry, !!state.catalog);
    this.current = state;
    this.wire = raw.unchanged === true && state.catalog ? this.wire : entry;
    publish(state);
    await storing;
    return state;
  }

  private store(userId: string, entry: CacheEntry | null, hasCatalog: boolean): Promise<void> {
    if (entry) return this.persist(() => this.cache.write(userId, entry));
    if (!hasCatalog) return this.persist(() => this.cache.remove(userId));
    return Promise.resolve();
  }
}

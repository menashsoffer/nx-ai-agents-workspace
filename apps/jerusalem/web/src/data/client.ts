import type { PublicFunctions, PublicSchema } from '../database.types.ts';
import { databaseRuleMessage } from '../lib/rules/messages.ts';
import { reasonMessage } from '../lib/errors/reasons.ts';
import { tagRequest } from '../lib/telemetry.ts';
import {
  FAILURES,
  failureSentence,
  kindOfNetworkError,
  kindOfStatus,
  type FailureKind,
} from '../lib/errors/failure.ts';

type Resource = keyof PublicSchema;
type Row<T extends Resource> = PublicSchema[T]['Row'];
type WritableResource = {
  [T in Resource]: PublicSchema[T] extends { Insert: unknown; Update: unknown } ? T : never;
}[Resource];
type Insert<T extends WritableResource> = PublicSchema[T] extends { Insert: infer I } ? I : never;
type Update<T extends WritableResource> = PublicSchema[T] extends { Update: infer U } ? U : never;

export class DataError extends Error {
  readonly status: number;
  /** What went wrong (error-handling-spec-he.md section 3). */
  readonly kind: FailureKind;

  /**
   * `rule` is the Hebrew message of a content rule the database refused (lib/rules).
   * `kind` overrides the kind read from the status, for failures without an HTTP answer.
   */
  constructor(status: number, rule: string | null = null, kind?: FailureKind) {
    const resolved = rule ? 'rule' : (kind ?? (status === 0 ? 'system' : kindOfStatus(status)));
    super(rule ?? failureSentence(FAILURES[resolved]));
    this.status = status;
    this.kind = resolved;
  }

  /** True only when sending the same request again can succeed. */
  get retryable(): boolean {
    return FAILURES[this.kind].retry;
  }
}

interface ErrorBody {
  code: string;
  message: string;
}

/** PostgREST and our Edge Functions answer a failure with JSON; anything else reads as empty. */
async function errorBody(response: Response): Promise<ErrorBody> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    return {
      code: typeof body.code === 'string' ? body.code : '',
      message: typeof body.message === 'string' ? body.message : '',
    };
  } catch {
    return { code: '', message: '' };
  }
}

/**
 * The error for a failed answer. A refused content rule arrives as `invalid:<key>`, a
 * business refusal as `reason:<key>`; both keep the HTTP status the SQL code gave them.
 */
export async function failedResponse(response: Response): Promise<DataError> {
  const body = await errorBody(response);
  const rule = response.status === 400 ? databaseRuleMessage(body.message) : null;
  if (rule) return new DataError(response.status, rule);
  return refusal(response.status, body.message, kindOfStatus(response.status, body.code));
}

/** A `reason:<key>` message becomes its Hebrew text; anything else keeps the given kind. */
export function refusal(status: number, message: string, otherwise: FailureKind): DataError {
  const reason = reasonMessage(message);
  const error = new DataError(status, null, reason ? 'reason' : otherwise);
  if (reason) error.message = reason;
  return error;
}

/** Node and old test environments have no navigator.onLine; treat them as online. */
function isOnline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine ?? true;
}

/** A request that never got an answer: offline, timed out, or the server is unreachable. */
export function unanswered(error: unknown): DataError {
  return new DataError(0, null, kindOfNetworkError(error, isOnline()));
}

class UnconfirmedChange extends DataError {
  constructor() {
    super(0, null, 'unconfirmed');
  }
}

/** Reads are sent once more after this pause when the failure may pass (spec section 7). */
export const READ_RETRY_MS = 2000;

/** A request that has not answered by then fails, so the page never shows "loading" forever. */
export const REQUEST_TIMEOUT_MS = 20_000;

export interface ClientOptions {
  baseUrl: string;
  publicKey: string;
  token: string;
  fetcher?: typeof fetch;
  onUnauthorized?: () => Promise<void>;
  /** Waits before a read is retried; tests pass one that does not wait. */
  pause?: (ms: number) => Promise<void>;
}

/** Database functions that only read, so a failed call may be sent again. */
const READ_RPCS: ReadonlySet<string> = new Set([
  'last_approaches',
  'load_control',
  'addresses_to_check',
  'admin_overview',
  'supplier_detail',
  'catalog_snapshot',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DataClient {
  private readonly fetcher: typeof fetch;
  private readonly root: string;
  private readonly headers: Record<string, string>;
  private readonly onUnauthorized: (() => Promise<void>) | undefined;
  private readonly pause: (ms: number) => Promise<void>;

  constructor(options: ClientOptions) {
    this.root = `${options.baseUrl.replace(/\/$/, '')}/rest/v1`;
    this.fetcher = options.fetcher ?? fetch;
    this.onUnauthorized = options.onUnauthorized;
    this.pause = options.pause ?? sleep;
    this.headers = {
      apikey: options.publicKey,
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    };
  }

  /** Reads that fail in a way that may pass are sent once more; writes never are. */
  private async request(
    path: string,
    init: RequestInit = {},
    read = (init.method ?? 'GET') === 'GET',
  ): Promise<unknown> {
    try {
      return await this.send(path, init);
    } catch (error) {
      if (!read || !(error instanceof DataError) || !error.retryable) throw error;
      if (error.kind === 'offline') throw error;
      await this.pause(READ_RETRY_MS);
      return this.send(path, init);
    }
  }

  private async send(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    const headers = new Headers(this.headers);
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    try {
      const fetcher = this.fetcher;
      response = await fetcher(`${this.root}/${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw unanswered(error);
    }
    if (response.status === 401) await this.onUnauthorized?.();
    if (!response.ok) throw await failedResponse(response);
    if (response.status === 204 || headers.get('Prefer') === 'return=minimal') return null;
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new DataError(0);
    }
  }

  async rpc<K extends keyof PublicFunctions>(
    name: K,
    args: PublicFunctions[K]['Args'],
  ): Promise<unknown> {
    const init = { method: 'POST', body: JSON.stringify(args) };
    return this.request(`rpc/${name}`, init, READ_RPCS.has(name)).catch((error: unknown) => {
      throw tagRequest(error, name);
    });
  }

  async supplierWrite(
    name: 'save_supplier_membership',
    payload: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.request(`rpc/${name}`, {
      method: 'POST',
      body: JSON.stringify({ payload }),
    });
    if (typeof result !== 'string') throw new DataError(0);
    return result;
  }

  async list<T extends Resource>(
    table: T,
    filters: Record<string, string> = {},
  ): Promise<Row<T>[]> {
    const result: Row<T>[] = [];
    const pageSize = 500;
    for (;;) {
      const query = new URLSearchParams({
        order: table === 'profiles' ? 'user_id.asc' : 'id.asc',
        ...filters,
        select: '*',
        limit: String(pageSize),
        offset: String(result.length),
      });
      const page = await this.request(`${table}?${query.toString()}`);
      if (!Array.isArray(page)) throw new DataError(0);
      result.push(...(page as Row<T>[]));
      if (page.length < pageSize) return result;
    }
  }

  async insert<T extends WritableResource>(table: T, row: Insert<T>): Promise<void> {
    await this.request(table, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  }

  async update<T extends WritableResource>(
    table: T,
    filters: Record<string, string>,
    row: Update<T>,
  ): Promise<void> {
    if (Object.keys(filters).length === 0) throw new Error('Update requires a filter');
    const result = await this.request(`${table}?${new URLSearchParams(filters).toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!Array.isArray(result) || result.length === 0) throw new UnconfirmedChange();
  }

  async remove(table: WritableResource, filters: Record<string, string>): Promise<void> {
    if (Object.keys(filters).length === 0) throw new Error('Delete requires a filter');
    const result = await this.request(`${table}?${new URLSearchParams(filters).toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!Array.isArray(result) || result.length === 0) throw new UnconfirmedChange();
  }
}

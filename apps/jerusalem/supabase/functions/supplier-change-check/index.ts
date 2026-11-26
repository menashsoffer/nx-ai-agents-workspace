import { serverEnv, type ServerEnv } from '../_shared/http/env.ts';
import { bearerToken, failure, json, preflight, readObject } from '../_shared/http/respond.ts';
import { failedStatus, rest } from '../_shared/http/rest.ts';
import { guidestarCredentials, type Credentials } from '../supplier-identifiers/sources.ts';
import { checkAll } from './checks.ts';
import type { Identifier } from './registry.ts';

// POST { supplier_id } with the caller's token, before an edit of the supplier is checked
// (documentation/supplier-edit-checks-spec-he.md, 6.3). Asks the registries about the
// supplier's own numbers that were not checked in the last day, and stores the answers with
// the service key. public.check_supplier_change then reads them, so the browser never
// carries a registry result.

declare const Deno: {
  serve: (handler: (request: Request) => Promise<Response>) => void;
  env: { get: (name: string) => string | undefined };
};

export interface Context {
  readonly env: ServerEnv | null;
  readonly guidestar: Credentials | null;
  readonly fetcher: typeof fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const MESSAGES: Record<number, string> = {
  401: 'Sign in required',
  403: 'Not authorized',
  404: 'Supplier not found',
  429: 'Too many lookups, try again later',
};

interface Accepted {
  readonly env: ServerEnv;
  readonly token: string;
  readonly supplierId: string;
}

async function accept(request: Request, ctx: Context): Promise<Accepted | Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return failure('Method not allowed', 405);
  const token = bearerToken(request);
  if (!token) return failure(MESSAGES[401] ?? '', 401);
  if (!ctx.env) return failure('Server not configured', 503);
  const body = await readObject(request);
  const supplierId = body?.supplier_id;
  if (typeof supplierId !== 'string' || !UUID.test(supplierId)) {
    return failure('Expected supplier_id (uuid)', 400);
  }
  return { env: ctx.env, token, supplierId };
}

async function check(job: Accepted, ctx: Context): Promise<Response> {
  const { env, token, supplierId } = job;
  const loaded = await rest(
    env,
    { path: 'rpc/registry_check_input', body: { target: supplierId }, as: { token } },
    ctx.fetcher,
  );
  if (loaded.status !== 200) {
    const status = failedStatus(loaded);
    return failure(MESSAGES[status] ?? 'Database unavailable', status);
  }
  const items = (loaded.body as { identifiers: Identifier[] }).identifiers;
  if (items.length === 0) return json({ checked: 0, sources: {} });
  const { results, sources } = await checkAll(items, ctx.guidestar, ctx.fetcher);
  if (results.length === 0) return json({ checked: 0, sources });
  const saved = await rest(
    env,
    { path: 'rpc/save_registry_checks', body: { target: supplierId, results }, as: 'service' },
    ctx.fetcher,
  );
  if (saved.status !== 200) return failure('Could not save the registry answers', 502);
  return json({ checked: saved.body, sources });
}

export async function handle(request: Request, ctx: Context): Promise<Response> {
  const job = await accept(request, ctx);
  return job instanceof Response ? job : check(job, ctx);
}

if (typeof Deno !== 'undefined') {
  const read = (name: string) => Deno.env.get(name);
  const ctx = { env: serverEnv(read), guidestar: guidestarCredentials(read), fetcher: fetch };
  Deno.serve((request) => handle(request, ctx));
}

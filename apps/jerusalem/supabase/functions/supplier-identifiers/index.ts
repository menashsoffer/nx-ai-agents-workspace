import { serverEnv, type ServerEnv } from '../_shared/http/env.ts';
import { bearerToken, failure, json, preflight, readObject } from '../_shared/http/respond.ts';
import { failedStatus, rest } from '../_shared/http/rest.ts';
import {
  guidestarCredentials,
  searchGuidestar,
  searchRegistrar,
  type Credentials,
} from './sources.ts';

export { guidestarCredentials };

// POST { supplier_id } with the caller's token. Searches the Companies Registrar
// and GuideStar by the supplier's names and stores what they find as candidates.
// Nothing becomes an identifier until an editor accepts a candidate
// (public.decide_identifier_candidate) and a second person verifies it.

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

interface LookupInput {
  readonly user_id: string;
  readonly names: string[];
}

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

async function lookup(job: Accepted, ctx: Context): Promise<Response> {
  const { env, token, supplierId } = job;
  const loaded = await rest(
    env,
    { path: 'rpc/identifier_lookup_input', body: { target: supplierId }, as: { token } },
    ctx.fetcher,
  );
  if (loaded.status !== 200) {
    const status = failedStatus(loaded);
    return failure(MESSAGES[status] ?? 'Database unavailable', status);
  }
  const input = loaded.body as LookupInput;
  const [registrar, guidestar] = await Promise.all([
    searchRegistrar(input.names, ctx.fetcher),
    searchGuidestar(input.names, ctx.guidestar, ctx.fetcher),
  ]);
  const found = [...registrar.found, ...guidestar.found];
  const args = { target: supplierId, finder: input.user_id, found };
  const saved = await rest(
    env,
    { path: 'rpc/save_identifier_candidates', body: args, as: 'service' },
    ctx.fetcher,
  );
  if (saved.status !== 200) return failure('Could not save the candidates', 502);
  const sources = { companies_registrar: registrar.state, guidestar: guidestar.state };
  return json({ candidates: saved.body, searched: input.names, sources });
}

export async function handle(request: Request, ctx: Context): Promise<Response> {
  const job = await accept(request, ctx);
  return job instanceof Response ? job : lookup(job, ctx);
}

if (typeof Deno !== 'undefined') {
  const read = (name: string) => Deno.env.get(name);
  const ctx = { env: serverEnv(read), guidestar: guidestarCredentials(read), fetcher: fetch };
  Deno.serve((request) => handle(request, ctx));
}

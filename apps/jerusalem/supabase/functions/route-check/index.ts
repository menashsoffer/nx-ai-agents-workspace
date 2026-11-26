import { serverEnv, type ServerEnv } from '../_shared/http/env.ts';
import { bearerToken, failure, json, preflight, readObject } from '../_shared/http/respond.ts';
import { failedStatus, rest } from '../_shared/http/rest.ts';
import type { IsoDate } from '../_shared/procurement/index.ts';
import { parseTarget, runEngine, type CheckInput, type Checked, type Target } from './prepare.ts';

// POST { request_id, on? } with the caller's token. Two database calls: one that
// authorizes, counts the quota and loads every input, and one insert of the result.
// POST { draft, on? } checks an unsaved draft: one call, nothing is stored, id is null.

declare const Deno: {
  serve: (handler: (request: Request) => Promise<Response>) => void;
  env: { get: (name: string) => string | undefined };
};

export const ENGINE_VERSION = 'procurement-ts/2026-11-16';

export interface Context {
  readonly env: ServerEnv | null;
  readonly fetcher: typeof fetch;
  readonly today: IsoDate;
}

const MESSAGES: Record<number, string> = {
  401: 'Sign in required',
  403: 'Not authorized',
  404: 'Engagement request not found',
  429: 'Too many route checks, try again later',
};

interface Accepted {
  readonly env: ServerEnv;
  readonly token: string;
  readonly target: Target;
}

function record(checked: Checked, input: CheckInput, target: { requestId: string; on: IsoDate }) {
  const { result } = checked;
  return {
    request_id: target.requestId,
    threshold_id: checked.thresholdId,
    checked_on: target.on,
    input: { ...input.request, related: input.related },
    route: result.route,
    regulation: result.regulation,
    status: result.status,
    allowed: result.allowed,
    missing: result.missing,
    warnings: result.warnings,
    engine_version: ENGINE_VERSION,
    created_by: input.user_id,
  };
}

/** Everything that can be refused before touching the database. */
async function accept(request: Request, ctx: Context): Promise<Accepted | Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return failure('Method not allowed', 405);
  const token = bearerToken(request);
  if (!token) return failure(MESSAGES[401] ?? '', 401);
  if (!ctx.env) return failure('Server not configured', 503);
  const body = await readObject(request);
  const target = body && parseTarget(body, ctx.today);
  if (!target)
    return failure(
      'Expected request_id (uuid) or draft (object), and optional on (YYYY-MM-DD)',
      400,
    );
  return { env: ctx.env, token, target };
}

async function check(job: Accepted, fetcher: typeof fetch): Promise<Response> {
  const { env, token, target } = job;
  const load =
    'draft' in target
      ? { path: 'rpc/route_check_preview_input', body: { draft: target.draft } }
      : { path: 'rpc/route_check_input', body: { target: target.requestId } };
  const body = { ...load.body, check_on: target.on };
  const loaded = await rest(env, { path: load.path, body, as: { token } }, fetcher);
  if (loaded.status !== 200) {
    const status = failedStatus(loaded);
    return failure(MESSAGES[status] ?? 'Database unavailable', status);
  }
  const input = loaded.body as CheckInput;
  const checked = runEngine(input, target.on);
  // reason:<key> is shown to the person (error-handling-spec-he.md section 6).
  if (!checked) return failure('reason:no_thresholds', 422);
  if ('draft' in target) return json({ id: null, ...checked.result });
  const row = record(checked, input, target);
  const saved = await rest(env, { path: 'route_checks', body: row, as: 'service' }, fetcher);
  // Not the person's to fix: the site says it is a fault in the system, without "try again".
  if (saved.status !== 201) return failure('system', 502);
  const [stored] = saved.body as { id: number }[];
  return json({ id: stored?.id ?? null, ...checked.result });
}

export async function handle(request: Request, ctx: Context): Promise<Response> {
  const job = await accept(request, ctx);
  return job instanceof Response ? job : check(job, ctx.fetcher);
}

function israelToday(): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

if (typeof Deno !== 'undefined') {
  const env = serverEnv((name) => Deno.env.get(name));
  Deno.serve((request) => handle(request, { env, fetcher: fetch, today: israelToday() }));
}

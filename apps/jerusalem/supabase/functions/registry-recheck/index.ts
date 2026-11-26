import { serverEnv, type ServerEnv } from '../_shared/http/env.ts';
import { failure, json, preflight } from '../_shared/http/respond.ts';
import { rest } from '../_shared/http/rest.ts';
import { checkAll } from '../supplier-change-check/checks.ts';
import type { Identifier } from '../supplier-change-check/registry.ts';
import { guidestarCredentials, type Credentials } from '../supplier-identifiers/sources.ts';

// POST with no body, once a day from GitHub Actions (supplier-edit-checks-spec-he.md, 6.7).
// Asks the registries again about verified numbers whose last answer is 30 days old, and
// stores the answers, which marks a supplier whose body was deleted or wound up for
// review. It takes no input and only records registry answers, so it needs no caller
// token; a run that starts within an hour of the previous one is skipped.

declare const Deno: {
  serve: (handler: (request: Request) => Promise<Response>) => void;
  env: { get: (name: string) => string | undefined };
};

export const JOB = 'registry-recheck';
export const BATCH = 50;

export interface Context {
  readonly env: ServerEnv | null;
  readonly guidestar: Credentials | null;
  readonly fetcher: typeof fetch;
}

type Db = Context & { env: ServerEnv };

async function service(ctx: Db, fn: string, args: unknown) {
  return rest(ctx.env, { path: `rpc/${fn}`, body: args, as: 'service' }, ctx.fetcher);
}

async function run(ctx: Db) {
  const queued = await service(ctx, 'registry_recheck_queue', { batch_size: BATCH });
  if (queued.status !== 200 || !Array.isArray(queued.body)) throw new Error('Queue unavailable');
  const items = queued.body as Identifier[];
  const { results, sources } = await checkAll(items, ctx.guidestar, ctx.fetcher);
  const saved = await service(ctx, 'save_registry_rechecks', { results });
  if (saved.status !== 200) throw new Error('Could not save the answers');
  const failed = Object.values(sources).includes('failed');
  return { queued: items.length, checked: results.length, remaining: saved.body, sources, failed };
}

export async function handle(request: Request, ctx: Context): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return failure('Method not allowed', 405);
  const { env } = ctx;
  if (!env) return failure('Server not configured', 503);
  const db = { ...ctx, env };
  const started = await service(db, 'job_start', { job_name: JOB, min_gap_minutes: 60 });
  if (started.status !== 200) return failure('Database unavailable', 502);
  if (started.body === null) return json({ skipped: true });
  const finish = (status: string, detail: unknown) =>
    service(db, 'job_finish', { run_id: started.body, run_status: status, run_detail: detail });
  try {
    const outcome = await run(db);
    await finish(outcome.failed ? 'failed' : 'ok', outcome);
    return json(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await finish('failed', { error: message });
    return failure(message, 502);
  }
}

if (typeof Deno !== 'undefined') {
  const read = (name: string) => Deno.env.get(name);
  const ctx = { env: serverEnv(read), guidestar: guidestarCredentials(read), fetcher: fetch };
  Deno.serve((request) => handle(request, ctx));
}

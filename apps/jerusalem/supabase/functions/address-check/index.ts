import { serverEnv, type ServerEnv } from '../_shared/http/env.ts';
import { failure, json, preflight } from '../_shared/http/respond.ts';
import { rest } from '../_shared/http/rest.ts';
import { nominatim, queries, Refused, type Checked, type Provider } from './geocode.ts';
import { photon } from './photon.ts';

// POST with no body, from the hourly schedule or from the site after a supplier is
// saved. Checks the next addresses in public.address_check_queue against the map and
// saves the answers. It takes no input and only records map answers, so it needs no
// caller token; a run that starts within a minute of the previous one is skipped, which
// also keeps the map service at one request per second. Every request waits SPACING_MS
// first. When Nominatim refuses us, the batch moves on to Photon.

declare const Deno: {
  serve: (handler: (request: Request) => Promise<Response>) => void;
  env: { get: (name: string) => string | undefined };
};

export const JOB = 'address-check';
export const BATCH = 40;
export const SPACING_MS = 1100;
/** Stop asking the map after this long, well inside the Edge Function time limit. */
export const BUDGET_MS = 50000;
/** Tried in order: when one refuses us, the rest of the batch goes to the next. */
export const PROVIDERS: readonly Provider[] = [nominatim, photon];

export interface Context {
  readonly env: ServerEnv | null;
  readonly fetcher: typeof fetch;
  readonly wait: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly providers?: readonly Provider[];
}

interface Waiting {
  readonly contact_id: string;
  readonly value: string;
}

interface Answer extends Checked {
  readonly contact_id: string;
  readonly value: string;
}

async function service(ctx: Context & { env: ServerEnv }, fn: string, args: unknown) {
  return rest(ctx.env, { path: `rpc/${fn}`, body: args, as: 'service' }, ctx.fetcher);
}

/** Tries each form of the address until one is found; keeps the best answer. */
async function check(item: Waiting, ctx: Context, provider: Provider): Promise<Checked> {
  let best: Checked | null = null;
  for (const query of queries(item.value)) {
    await ctx.wait(SPACING_MS);
    const found = await provider.search(query, ctx.fetcher);
    if (found.result === 'found') return found;
    if (!best || found.result === 'approximate') best = found;
  }
  return best ?? { result: 'not_found', map_label: null, latitude: null, longitude: null };
}

async function safeCheck(item: Waiting, ctx: Context, provider: Provider): Promise<Checked> {
  try {
    return await check(item, ctx, provider);
  } catch (error) {
    if (error instanceof Refused) throw error;
    return { result: 'failed', map_label: null, latitude: null, longitude: null };
  }
}

interface Batch {
  readonly answers: Answer[];
  readonly refusals: { provider: string; status: number }[];
  /** The services still willing to answer, current one first. */
  readonly providers: Provider[];
}

/** One address, moving on to the next service while the current one refuses us. */
async function checkOne(item: Waiting, ctx: Context, batch: Batch) {
  const { providers } = batch;
  for (let provider = providers[0]; provider; provider = providers[0]) {
    try {
      const checked = await safeCheck(item, ctx, provider);
      batch.answers.push({ contact_id: item.contact_id, value: item.value, ...checked });
      return true;
    } catch (error) {
      batch.refusals.push({ provider: provider.name, status: (error as Refused).status });
      providers.shift();
    }
  }
  return false;
}

/** Checks the batch in order; stops at the time budget or when every service refuses. */
export async function checkAll(items: Waiting[], ctx: Context) {
  const started = ctx.now();
  const batch: Batch = { answers: [], refusals: [], providers: [...(ctx.providers ?? PROVIDERS)] };
  for (const item of items) {
    if (ctx.now() - started > BUDGET_MS) break;
    if (!(await checkOne(item, ctx, batch))) break;
  }
  const { answers, refusals, providers } = batch;
  return {
    answers,
    refusals,
    refused: providers.length === 0,
    provider: providers[0]?.name ?? null,
  };
}

async function run(ctx: Context & { env: ServerEnv }) {
  const queued = await service(ctx, 'address_check_queue', { batch_size: BATCH });
  if (queued.status !== 200 || !Array.isArray(queued.body)) throw new Error('Queue unavailable');
  const { answers, refused, refusals, provider } = await checkAll(queued.body as Waiting[], ctx);
  const saved = await service(ctx, 'save_address_checks', { results: answers });
  if (saved.status !== 200) throw new Error('Could not save the answers');
  const counts: Record<string, number> = {};
  for (const answer of answers) counts[answer.result] = (counts[answer.result] ?? 0) + 1;
  const remaining = saved.body as number;
  return { checked: answers.length, counts, remaining, refused, provider, refusals };
}

export async function handle(request: Request, ctx: Context): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return failure('Method not allowed', 405);
  const { env } = ctx;
  if (!env) return failure('Server not configured', 503);
  const db = { ...ctx, env };
  const started = await service(db, 'job_start', { job_name: JOB, min_gap_minutes: 1 });
  if (started.status !== 200) return failure('Database unavailable', 502);
  if (started.body === null) return json({ skipped: true });
  const finish = (status: string, detail: unknown) =>
    service(db, 'job_finish', { run_id: started.body, run_status: status, run_detail: detail });
  try {
    const outcome = await run(db);
    await finish(outcome.refused ? 'failed' : 'ok', outcome);
    return json(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await finish('failed', { error: message });
    return failure(message, 502);
  }
}

if (typeof Deno !== 'undefined') {
  const env = serverEnv((name) => Deno.env.get(name));
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  Deno.serve((request) => handle(request, { env, fetcher: fetch, wait, now: Date.now }));
}

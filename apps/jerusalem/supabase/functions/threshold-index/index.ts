import { serverEnv, type ServerEnv } from '../_shared/http/env.ts';
import { failure, json } from '../_shared/http/respond.ts';
import { rest } from '../_shared/http/rest.ts';
import { MISSING_OBSERVATION, cbsIndex, storedCpi } from '../_shared/procurement/cbs.ts';
import type { IsoDate } from '../_shared/procurement/index.ts';
import { periodsAround, type Period } from './periods.ts';

// POST with no body, from the daily schedule. Reads the CPI from CBS and proposes
// the threshold row for the current and next month when it is missing. The call
// takes no input and changes nothing in force, so it needs no caller token; a run
// that starts within MIN_GAP_MINUTES of the previous one is skipped.

declare const Deno: {
  serve: (handler: (request: Request) => Promise<Response>) => void;
  env: { get: (name: string) => string | undefined };
};

export const JOB = 'threshold-index';
export const MIN_GAP_MINUTES = 30;
export const CBS_URL =
  'https://api.cbs.gov.il/index/data/price?id=120010&format=json&download=false&last=3&coef=true';
const CBS_TIMEOUT_MS = 8000;

export interface Context {
  readonly env: ServerEnv | null;
  readonly fetcher: typeof fetch;
  readonly today: IsoDate;
}

type Answer = 'covered' | 'pending' | 'decided' | 'proposed' | 'not_published';

interface Outcome {
  readonly starts_on: IsoDate;
  readonly result: Answer;
}

interface Db {
  readonly env: ServerEnv;
  readonly fetcher: typeof fetch;
}

async function service(db: Db, fn: string, args: unknown) {
  return rest(db.env, { path: `rpc/${fn}`, body: args, as: 'service' }, db.fetcher);
}

async function readCbs(fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(CBS_URL, { signal: AbortSignal.timeout(CBS_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`CBS answered ${String(response.status)}`);
  return response.json();
}

function indexFor(cbs: unknown, period: Period): number | null {
  try {
    return cbsIndex(cbs, period.year, period.month);
  } catch (error) {
    if (error instanceof Error && error.message === MISSING_OBSERVATION) return null;
    throw error;
  }
}

async function propose(db: Db, cbs: unknown, period: Period) {
  const index = indexFor(cbs, period);
  if (index === null) return 'not_published';
  const stored = storedCpi(index, period.year, period.month);
  const args = {
    cpi: stored.index,
    starts_on: period.startsOn,
    cpi_source: stored.thresholds.source,
  };
  const answer = await service(db, 'propose_threshold', args);
  if (answer.status !== 200) throw new Error('Could not save the proposal');
  return answer.body as Answer;
}

async function run(db: Db, today: IsoDate): Promise<Outcome[]> {
  const cbs = await readCbs(db.fetcher);
  const outcomes: Outcome[] = [];
  for (const period of periodsAround(today)) {
    const result = await propose(db, cbs, period);
    outcomes.push({ starts_on: period.startsOn, result });
  }
  return outcomes;
}

export async function handle(request: Request, ctx: Context): Promise<Response> {
  if (request.method !== 'POST') return failure('Method not allowed', 405);
  if (!ctx.env) return failure('Server not configured', 503);
  const db = { env: ctx.env, fetcher: ctx.fetcher };
  const started = await service(db, 'job_start', {
    job_name: JOB,
    min_gap_minutes: MIN_GAP_MINUTES,
  });
  if (started.status !== 200) return failure('Database unavailable', 502);
  if (started.body === null) return json({ skipped: true });
  const finish = (status: string, detail: unknown) =>
    service(db, 'job_finish', { run_id: started.body, run_status: status, run_detail: detail });
  try {
    const periods = await run(db, ctx.today);
    await finish('ok', { periods });
    return json({ periods });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await finish('failed', { error: message });
    return failure(message, 502);
  }
}

function israelToday(): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

if (typeof Deno !== 'undefined') {
  const env = serverEnv((name) => Deno.env.get(name));
  Deno.serve((request) => handle(request, { env, fetcher: fetch, today: israelToday() }));
}

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { BATCH, JOB, handle, type Context } from '../registry-recheck/index.ts';

const ENV = { url: 'https://project.test', publicKey: 'pk', secretKey: 'sk' };
const QUEUE = [
  { id: 'i1', supplier_id: 's1', scheme: 'company', value: '515301596' },
  { id: 'i2', supplier_id: 's2', scheme: 'nonprofit', value: '580536878' },
];
const RECORD = { 'מספר חברה': 515301596, 'שם חברה': 'א בע~מ', 'סטטוס חברה': 'בפירוק' };

interface Call {
  readonly path: string;
  readonly auth: string | null;
  readonly body: Record<string, unknown> | null;
}

interface Upstream {
  readonly start?: Response;
  readonly queue?: Response;
  readonly registrar?: Response;
}

function database(path: string, upstream: Upstream): Response {
  if (path.endsWith('job_start')) return upstream.start ?? Response.json(7);
  if (path.endsWith('job_finish')) return new Response(null, { status: 204 });
  if (path.endsWith('registry_recheck_queue')) return upstream.queue ?? Response.json(QUEUE);
  return Response.json(3);
}

function answer(url: URL, upstream: Upstream): Response {
  const path = url.pathname;
  if (path.includes('/rpc/')) return database(path, upstream);
  if (url.hostname === 'data.gov.il') {
    if (!url.searchParams.get('resource_id')?.startsWith('f004176c')) {
      return Response.json({ success: true, result: { records: [] } });
    }
    return upstream.registrar ?? Response.json({ success: true, result: { records: [RECORD] } });
  }
  if (path.endsWith('/login')) return Response.json({ sessionId: 'session-1' });
  return Response.json({ name: 'הסדנא', malkarStatus: 'רשומה', isActive: true });
}

function fake(upstream: Upstream = {}) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = (target, init) => {
    const url = new URL(target instanceof Request ? target.url : target.toString());
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
    calls.push({ path: url.pathname, auth: new Headers(init?.headers).get('authorization'), body });
    return Promise.resolve(answer(url, upstream).clone());
  };
  return { calls, fetcher };
}

function ctx(fetcher: typeof fetch): Context {
  return { env: ENV, guidestar: { username: 'u', password: 'p' }, fetcher };
}

const post = () => new Request('https://fn.test', { method: 'POST' });
const finished = (calls: Call[]) => calls.find((c) => c.path.endsWith('job_finish'))?.body;

describe('registry-recheck', () => {
  it('asks both registries about a batch and saves the answers as the service', async () => {
    const { calls, fetcher } = fake();
    const response = await handle(post(), ctx(fetcher));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      queued: 2,
      checked: 2,
      remaining: 3,
      sources: { companies_registrar: 'ok', guidestar: 'ok', datagov: 'ok' },
      failed: false,
    });
    const start = calls.find((c) => c.path.endsWith('job_start'));
    assert.deepEqual(start?.body, { job_name: JOB, min_gap_minutes: 60 });
    const queue = calls.find((c) => c.path.endsWith('registry_recheck_queue'));
    assert.deepEqual(queue?.body, { batch_size: BATCH });
    const save = calls.find((c) => c.path.endsWith('save_registry_rechecks'));
    assert.equal(save?.auth, 'Bearer sk');
    const results = save.body?.results as { id: string; status: string }[];
    assert.deepEqual(
      results.map((r) => [r.id, r.status]),
      [
        ['i1', 'בפירוק'],
        ['i2', 'רשומה'],
      ],
    );
    assert.equal(finished(calls)?.run_status, 'ok');
  });

  it('records a run as failed when a registry did not answer', async () => {
    const { calls, fetcher } = fake({ registrar: new Response('', { status: 500 }) });
    const body = (await (await handle(post(), ctx(fetcher))).json()) as { checked: number };
    assert.equal(body.checked, 1);
    assert.equal(finished(calls)?.run_status, 'failed');
  });

  it('skips a run too soon after the last one, and reports a broken queue', async () => {
    const skipped = fake({ start: Response.json(null) });
    assert.deepEqual(await (await handle(post(), ctx(skipped.fetcher))).json(), { skipped: true });
    assert.equal(skipped.calls.length, 1);
    const broken = fake({ queue: Response.json({}, { status: 500 }) });
    assert.equal((await handle(post(), ctx(broken.fetcher))).status, 502);
    assert.equal(finished(broken.calls)?.run_status, 'failed');
    const down = fake({ start: Response.json({}, { status: 500 }) });
    assert.equal((await handle(post(), ctx(down.fetcher))).status, 502);
  });

  it('answers only a POST on a configured server', async () => {
    const { calls, fetcher } = fake();
    assert.equal((await handle(new Request('https://fn.test'), ctx(fetcher))).status, 405);
    const options = new Request('https://fn.test', { method: 'OPTIONS' });
    assert.equal((await handle(options, ctx(fetcher))).status, 204);
    assert.equal((await handle(post(), { ...ctx(fetcher), env: null })).status, 503);
    assert.equal(calls.length, 0);
  });
});

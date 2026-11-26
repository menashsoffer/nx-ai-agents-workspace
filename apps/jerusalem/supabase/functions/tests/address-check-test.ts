import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { BUDGET_MS, checkAll, handle, SPACING_MS, type Context } from '../address-check/index.ts';
import {
  classify,
  cleanAddress,
  NOMINATIM,
  queries,
  USER_AGENT,
} from '../address-check/geocode.ts';
import { classifyPhoton, PHOTON } from '../address-check/photon.ts';

const ENV = { url: 'https://project.test', publicKey: 'pk', secretKey: 'sk' };
const post = () => new Request('https://fn.test', { method: 'POST' });

// The shape of a Nominatim jsonv2 hit, trimmed to the fields we read.
const STREET = [{ place_rank: 30, display_name: 'יפו 216, ירושלים', lat: '31.78', lon: '35.20' }];
const TOWN = [{ place_rank: 16, display_name: 'ירושלים', lat: '31.77', lon: '35.21' }];
// The shape of a Photon GeoJSON answer, trimmed the same way.
const PHOTON_STREET = {
  features: [
    {
      geometry: { coordinates: [35.2, 31.78] },
      properties: { type: 'house', street: 'יפו', housenumber: '216', city: 'ירושלים' },
    },
  ],
};

interface Fake {
  readonly rpc: { path: string; body: Record<string, unknown> | null }[];
  readonly map: { query: string; agent: string | null; photon: boolean }[];
  readonly waits: number[];
  readonly ctx: Context;
}

type MapAnswer = (query: string, photon: boolean) => Response;

function fake(map: MapAnswer, answers: Record<string, unknown> = {}): Fake {
  const rpc: Fake['rpc'] = [];
  const calls: Fake['map'] = [];
  const waits: number[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const photon = url.href.startsWith(PHOTON);
    if (photon || url.href.startsWith(NOMINATIM)) {
      const query = url.searchParams.get('q') ?? '';
      calls.push({ query, agent: new Headers(init?.headers).get('user-agent'), photon });
      return Promise.resolve(map(query, photon));
    }
    const path = url.pathname.replace('/rest/v1/rpc/', '');
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
    rpc.push({ path, body });
    return Promise.resolve(Response.json(path in answers ? answers[path] : 1));
  };
  const wait = (ms: number) => {
    waits.push(ms);
    return Promise.resolve();
  };
  return { rpc, map: calls, waits, ctx: { env: ENV, fetcher, wait, now: () => 0 } };
}

const queue = [
  { contact_id: 'a', value: "רח' יפו 216 (כניסה ב'), ירושלים 9434001" },
  { contact_id: 'b', value: 'מכמורת' },
  { contact_id: 'c', value: 'אין כזה 1, שכונה, ירושלים' },
];

describe('address cleaning', () => {
  it('drops street prefixes, notes in brackets, quotes and postal codes', () => {
    assert.equal(cleanAddress(queue[0]?.value ?? ''), 'יפו 216, ירושלים');
    assert.equal(cleanAddress('"מלון הנשיא", טלביה, ירושלים'), 'מלון הנשיא, טלביה, ירושלים');
    assert.equal(cleanAddress('דרך החורש 4, יהוד / שמירה אימבר 9, קרית אונו'), 'דרך החורש 4, יהוד');
  });

  it('adds a street-and-town query when the address has middle parts', () => {
    assert.deepEqual(queries('שרייבום 26, רמת בית הכרם, ירושלים'), [
      'שרייבום 26, רמת בית הכרם, ירושלים',
      'שרייבום 26, ירושלים',
    ]);
    assert.deepEqual(queries('(הערה)'), []);
  });

  it('reads street hits as found and town hits as approximate', () => {
    assert.equal(classify(STREET).result, 'found');
    assert.equal(classify(STREET).latitude, 31.78);
    assert.equal(classify(TOWN).result, 'approximate');
    assert.equal(classify([]).result, 'not_found');
    assert.equal(classify({ error: 'x' }).result, 'not_found');
    assert.equal(classify([{ lat: 'x' }]).latitude, null);
  });
});

describe('photon answers', () => {
  it('reads house and street hits as found, other hits as approximate', () => {
    const found = classifyPhoton(PHOTON_STREET);
    assert.deepEqual(found, {
      result: 'found',
      map_label: 'יפו 216, ירושלים',
      latitude: 31.78,
      longitude: 35.2,
    });
    const town = { features: [{ properties: { type: 'city', name: 'ירושלים' } }] };
    assert.deepEqual(classifyPhoton(town), {
      result: 'approximate',
      map_label: 'ירושלים',
      latitude: null,
      longitude: null,
    });
    assert.equal(classifyPhoton({ features: [{}] }).map_label, null);
    assert.equal(classifyPhoton({ features: [] }).result, 'not_found');
    assert.equal(classifyPhoton(null).result, 'not_found');
  });
});

describe('address-check function', () => {
  it('checks the queue one request per second and saves every answer', async () => {
    const map = (query: string) =>
      Response.json(query.startsWith('יפו') ? STREET : query === 'מכמורת' ? TOWN : []);
    const f = fake(map, { address_check_queue: queue, save_address_checks: 7, job_start: 5 });
    const response = await handle(post(), f.ctx);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      checked: 3,
      counts: { found: 1, approximate: 1, not_found: 1 },
      remaining: 7,
      refused: false,
      provider: 'nominatim',
      refusals: [],
    });
    assert.deepEqual(
      f.map.map((call) => call.query),
      ['יפו 216, ירושלים', 'מכמורת', 'אין כזה 1, שכונה, ירושלים', 'אין כזה 1, ירושלים'],
    );
    assert.ok(f.map.every((call) => call.agent === USER_AGENT));
    assert.deepEqual(f.waits, [SPACING_MS, SPACING_MS, SPACING_MS, SPACING_MS]);
    const saved = f.rpc.find((call) => call.path === 'save_address_checks');
    const results = saved?.body?.results as { contact_id: string; result: string }[];
    assert.deepEqual(
      results.map((r) => [r.contact_id, r.result]),
      [
        ['a', 'found'],
        ['b', 'approximate'],
        ['c', 'not_found'],
      ],
    );
    assert.equal(f.rpc.at(-1)?.body?.run_status, 'ok');
  });

  it('moves the batch to Photon when Nominatim refuses us', async () => {
    const map = (_query: string, photon: boolean) =>
      photon ? Response.json(PHOTON_STREET) : new Response('', { status: 403 });
    const f = fake(map, { address_check_queue: queue.slice(0, 2), job_start: 5 });
    const body = (await (await handle(post(), f.ctx)).json()) as Record<string, unknown>;
    assert.equal(body.provider, 'photon');
    assert.deepEqual(body.refusals, [{ provider: 'nominatim', status: 403 }]);
    assert.deepEqual(body.counts, { found: 2 });
    assert.deepEqual(
      f.map.map((call) => call.photon),
      [false, true, true],
    );
    assert.equal(f.rpc.at(-1)?.body?.run_status, 'ok');
  });

  it('stops the batch when every map service refuses and records the run as failed', async () => {
    const f = fake(() => new Response('', { status: 429 }), {
      address_check_queue: queue,
      job_start: 5,
    });
    const body = (await (await handle(post(), f.ctx)).json()) as Record<string, unknown>;
    assert.equal(body.checked, 0);
    assert.equal(body.refused, true);
    assert.equal(body.provider, null);
    assert.equal(f.map.length, 2);
    assert.equal(f.rpc.at(-1)?.body?.run_status, 'failed');
  });

  it('marks a map error as failed and goes on', async () => {
    const f = fake(() => new Response('', { status: 500 }));
    const { answers } = await checkAll(queue.slice(0, 2), f.ctx);
    assert.deepEqual(
      answers.map((a) => a.result),
      ['failed', 'failed'],
    );
  });

  it('stops asking at the time budget', async () => {
    const f = fake(() => Response.json(STREET));
    let clock = 0;
    const ctx = { ...f.ctx, now: () => (clock += BUDGET_MS) };
    const { answers } = await checkAll(queue, ctx);
    assert.equal(answers.length, 1);
  });

  it('skips a run that starts too soon after the previous one', async () => {
    const f = fake(() => Response.json([]), { job_start: null });
    assert.deepEqual(await (await handle(post(), f.ctx)).json(), { skipped: true });
    assert.equal(f.map.length, 0);
  });

  it('reports a broken queue, a failed save and a missing setup', async () => {
    const broken = fake(() => Response.json([]), { job_start: 5, address_check_queue: {} });
    assert.equal((await handle(post(), broken.ctx)).status, 502);
    const unsaved = fake(() => Response.json([]), { job_start: 5, address_check_queue: [] });
    const fetcher: typeof fetch = (input, init) =>
      (input instanceof Request ? input.url : input.toString()).includes('save_address_checks')
        ? Promise.resolve(new Response('', { status: 500 }))
        : unsaved.ctx.fetcher(input, init);
    assert.equal((await handle(post(), { ...unsaved.ctx, fetcher })).status, 502);
    const down = fake(() => Response.json([]));
    const offline: typeof fetch = () => Promise.resolve(new Response('', { status: 500 }));
    assert.equal((await handle(post(), { ...down.ctx, fetcher: offline })).status, 502);
    assert.equal((await handle(post(), { ...down.ctx, env: null })).status, 503);
    assert.equal((await handle(new Request('https://fn.test'), down.ctx)).status, 405);
    const options = new Request('https://fn.test', { method: 'OPTIONS' });
    assert.equal((await handle(options, down.ctx)).status, 204);
  });
});

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { serverEnv } from '../_shared/http/env.ts';
import { ENGINE_VERSION, handle, type Context } from '../route-check/index.ts';

const ENV = { url: 'https://project.test', publicKey: 'pk', secretKey: 'sk' };
const REQUEST_ID = '50000000-0000-0000-0000-000000000001';
const THRESHOLDS = {
  id: 't1',
  valid_from: '2026-10-16',
  valid_until: '2026-11-15',
  no_tender_max: '41200.00',
  zuta4_max: '100600.00',
  zuta6_max: '201200.00',
  source: 'test',
  is_official: false,
};
const INPUT = {
  user_id: 'u1',
  request: {
    estimated_value: '50000.00',
    value_includes_vat: false,
    requested_exemption: null,
    facts: {},
    subject_key: 'cleaning',
  },
  thresholds: THRESHOLDS,
  related: [{ estimated_value: 40000, value_includes_vat: true }],
};

interface Call {
  path: string;
  auth: string | null;
  body: Record<string, unknown>;
}

function database(rpc: Response, calls: Call[] = []): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const path = url.pathname.replace('/rest/v1/', '');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    calls.push({ path, auth: new Headers(init?.headers).get('authorization'), body });
    if (path.startsWith('rpc/route_check_')) return rpc.clone();
    return Promise.resolve(Response.json([{ id: 7 }], { status: 201 }));
  };
}

function ctx(fetcher: typeof fetch): Context {
  return { env: ENV, fetcher, today: '2026-11-01' };
}

function post(body: unknown, token: string | null = 'user-token'): Request {
  return new Request('https://fn.test', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
}

describe('route-check function', () => {
  it('answers CORS preflight without touching the database', async () => {
    const response = await handle(
      new Request('https://fn.test', { method: 'OPTIONS' }),
      ctx(database(new Response())),
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  });

  it('runs the engine on database values and saves the result as the service', async () => {
    const calls: Call[] = [];
    const response = await handle(
      post({ request_id: REQUEST_ID }),
      ctx(database(Response.json(INPUT), calls)),
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as Record<string, unknown>;
    assert.equal(result.id, 7);
    assert.equal(result.splittingChecked, true);
    const [load, save] = calls as [Call, Call];
    assert.equal(load.auth, 'Bearer user-token');
    assert.deepEqual(load.body, { target: REQUEST_ID, check_on: '2026-11-01' });
    assert.equal(save.path, 'route_checks');
    assert.equal(save.auth, 'Bearer sk');
    assert.equal(save.body.created_by, 'u1');
    assert.equal(save.body.threshold_id, 't1');
    assert.equal(save.body.engine_version, ENGINE_VERSION);
    assert.equal(save.body.route, result.route);
  });

  it('checks an unsaved draft as the caller and stores nothing', async () => {
    const calls: Call[] = [];
    const draft = { estimated_value: 50000, value_includes_vat: false };
    const preview = { ...INPUT, related: null };
    const response = await handle(post({ draft }), ctx(database(Response.json(preview), calls)));
    assert.equal(response.status, 200);
    const result = (await response.json()) as Record<string, unknown>;
    assert.equal(result.id, null);
    assert.equal(result.splittingChecked, false);
    assert.equal(calls.length, 1);
    const [load] = calls as [Call];
    assert.equal(load.path, 'rpc/route_check_preview_input');
    assert.equal(load.auth, 'Bearer user-token');
    assert.deepEqual(load.body, { draft, check_on: '2026-11-01' });
    const both = post({ draft, request_id: REQUEST_ID });
    assert.equal((await handle(both, ctx(database(new Response())))).status, 400);
    assert.equal((await handle(post({ draft: [] }), ctx(database(new Response())))).status, 400);
  });

  it('refuses bad input before calling the database', async () => {
    const none: typeof fetch = () => {
      throw new Error('unexpected call');
    };
    assert.equal((await handle(post({ request_id: REQUEST_ID }, null), ctx(none))).status, 401);
    assert.equal((await handle(post({ request_id: 'x' }), ctx(none))).status, 400);
    const badDate = post({ request_id: REQUEST_ID, on: '2026-02-30' });
    assert.equal((await handle(badDate, ctx(none))).status, 400);
    const get = new Request('https://fn.test', { headers: { Authorization: 'Bearer t' } });
    assert.equal((await handle(get, ctx(none))).status, 405);
    const unconfigured = { ...ctx(none), env: null };
    assert.equal((await handle(post({ request_id: REQUEST_ID }), unconfigured)).status, 503);
  });

  it('passes on the database refusal and saves nothing', async () => {
    for (const status of [401, 403, 404, 429]) {
      const calls: Call[] = [];
      const rpc = Response.json({ code: `PT${String(status)}` }, { status });
      const response = await handle(post({ request_id: REQUEST_ID }), ctx(database(rpc, calls)));
      assert.equal(response.status, status);
      assert.equal(calls.length, 1);
    }
    const broken = await handle(
      post({ request_id: REQUEST_ID }),
      ctx(database(new Response('', { status: 500 }))),
    );
    assert.equal(broken.status, 502);
  });

  it('reports a date with no thresholds instead of guessing', async () => {
    const calls: Call[] = [];
    const rpc = Response.json({ ...INPUT, thresholds: null });
    const response = await handle(post({ request_id: REQUEST_ID }), ctx(database(rpc, calls)));
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: 'reason:no_thresholds' });
    assert.equal(calls.length, 1);
  });

  // 18.11.2026: the insert was refused (42501) and the site said "try again".
  it('calls a refused save a fault in the system, not something to retry', async () => {
    const rpc = Response.json(INPUT);
    const refused: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes('/rpc/')) return database(rpc)(input, init);
      return Promise.resolve(Response.json({ code: '42501' }, { status: 403 }));
    };
    const response = await handle(post({ request_id: REQUEST_ID }), ctx(refused));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'system' });
  });
});

describe('server environment', () => {
  it('prefers the new key maps and falls back to the legacy keys', () => {
    const modern = serverEnv(
      (name) =>
        ({
          SUPABASE_URL: 'u',
          SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_x"}',
          SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}',
          SUPABASE_ANON_KEY: 'legacy',
        })[name],
    );
    assert.deepEqual(modern, { url: 'u', publicKey: 'sb_publishable_x', secretKey: 'sb_secret_x' });
    const legacy = serverEnv(
      (name) =>
        ({
          SUPABASE_URL: 'u',
          SUPABASE_ANON_KEY: 'a',
          SUPABASE_SERVICE_ROLE_KEY: 's',
        })[name],
    );
    assert.deepEqual(legacy, { url: 'u', publicKey: 'a', secretKey: 's' });
    assert.equal(
      serverEnv(() => undefined),
      null,
    );
  });
});

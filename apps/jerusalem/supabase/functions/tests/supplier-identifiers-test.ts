import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { guidestarCredentials, handle, type Context } from '../supplier-identifiers/index.ts';

const ENV = { url: 'https://project.test', publicKey: 'pk', secretKey: 'sk' };
const SUPPLIER = '40000000-0000-0000-0000-000000000001';
const CREDENTIALS = { username: 'user', password: 'secret' };

// Shapes of the real answers: data.gov.il checked 16.11.2026, GuideStar 13.11.2026.
const REGISTRAR = {
  success: true,
  result: {
    records: [
      { 'מספר חברה': 515301596, 'שם חברה': 'מגנזי אורבניקס בע~מ', 'סטטוס חברה': 'פעילה' },
      { 'מספר חברה': null, 'שם חברה': 'בלי מספר' },
    ],
  },
};
const GUIDESTAR = [
  { name: 'הסדנא', malkarType: 'עמותה', regNum: '580536878', malkarStatus: 'רשומה' },
  { name: 'הסדנא בע"מ', malkarType: 'חברה', regNum: '123456789' },
];

interface Call {
  readonly url: URL;
  readonly auth: string | null;
  readonly body: Record<string, unknown> | null;
}

interface Upstream {
  readonly input?: Response;
  readonly registrar?: Response;
  readonly login?: Response;
}

function answer(url: URL, body: Record<string, unknown> | null, upstream: Upstream): Response {
  const path = url.pathname;
  if (path.endsWith('identifier_lookup_input')) {
    return upstream.input ?? Response.json({ user_id: 'u1', names: ['הסדנא'] });
  }
  if (path.endsWith('save_identifier_candidates')) return Response.json(body?.found);
  if (url.hostname === 'data.gov.il') return upstream.registrar ?? Response.json(REGISTRAR);
  if (path.endsWith('/login')) return upstream.login ?? Response.json({ sessionId: 'session-1' });
  return Response.json(GUIDESTAR);
}

function fake(upstream: Upstream = {}) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = (target, init) => {
    const url = new URL(target instanceof Request ? target.url : target.toString());
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
    calls.push({ url, auth: new Headers(init?.headers).get('authorization'), body });
    return Promise.resolve(answer(url, body, upstream).clone());
  };
  return { calls, fetcher };
}

function ctx(fetcher: typeof fetch, guidestar = CREDENTIALS): Context {
  return { env: ENV, guidestar, fetcher };
}

function post(body: unknown, token: string | null = 'user-token'): Request {
  return new Request('https://fn.test', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
}

describe('supplier-identifiers', () => {
  it('stores registrar companies and GuideStar nonprofits as candidates', async () => {
    const { calls, fetcher } = fake();
    const response = await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { candidates: Record<string, unknown>[] };
    assert.deepEqual(
      body.candidates.map((c) => [c.scheme, c.value, c.registrar_name]),
      [
        ['company', '515301596', 'מגנזי אורבניקס בע"מ'],
        ['nonprofit', '580536878', 'הסדנא'],
      ],
      'only valid numbers, only nonprofits from GuideStar',
    );
    const lookup = calls.find((c) => c.url.pathname.endsWith('identifier_lookup_input'));
    assert.equal(lookup?.auth, 'Bearer user-token', 'authorized with the caller token');
    const save = calls.find((c) => c.url.pathname.endsWith('save_identifier_candidates'));
    assert.equal(save?.auth, 'Bearer sk');
    assert.equal(save.body?.finder, 'u1');
    assert.doesNotMatch(JSON.stringify(body), /secret|session-1/);
  });

  it('passes on refusals from the database without searching', async () => {
    for (const status of [401, 403, 404, 429]) {
      const { calls, fetcher } = fake({ input: Response.json({}, { status }) });
      const response = await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher));
      assert.equal(response.status, status);
      assert.equal(calls.length, 1);
    }
  });

  it('keeps the other source when one fails, and reports which', async () => {
    const { fetcher } = fake({ login: new Response('', { status: 401 }) });
    const response = await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher));
    const body = (await response.json()) as { candidates: unknown[]; sources: unknown };
    assert.equal(body.candidates.length, 1);
    assert.deepEqual(body.sources, { companies_registrar: 'ok', guidestar: 'failed' });
  });

  it('skips GuideStar when no account is configured', async () => {
    const { calls, fetcher } = fake();
    const response = await handle(post({ supplier_id: SUPPLIER }), {
      ...ctx(fetcher),
      guidestar: null,
    });
    const body = (await response.json()) as { sources: Record<string, string> };
    assert.equal(body.sources.guidestar, 'not_configured');
    assert.ok(calls.every((c) => c.url.hostname !== 'www.guidestar.org.il'));
  });

  it('rejects bad input before touching the database', async () => {
    const { calls, fetcher } = fake();
    assert.equal((await handle(post({ supplier_id: 'x' }), ctx(fetcher))).status, 400);
    assert.equal((await handle(post({ supplier_id: SUPPLIER }, null), ctx(fetcher))).status, 401);
    const get = new Request('https://fn.test');
    assert.equal((await handle(get, ctx(fetcher))).status, 405);
    const options = new Request('https://fn.test', { method: 'OPTIONS' });
    assert.equal((await handle(options, ctx(fetcher))).status, 204);
    assert.equal(calls.length, 0);
  });

  it('reads the GuideStar account only when both settings exist', () => {
    const settings: Record<string, string> = { GUIDESTAR_USERNAME: 'u', GUIDESTAR_PASSWORD: 'p' };
    assert.deepEqual(
      guidestarCredentials((n) => settings[n]),
      { username: 'u', password: 'p' },
    );
    assert.equal(
      guidestarCredentials((n) => (n === 'GUIDESTAR_USERNAME' ? 'u' : undefined)),
      null,
    );
  });
});

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { handle, type Context } from '../supplier-change-check/index.ts';

const ENV = { url: 'https://project.test', publicKey: 'pk', secretKey: 'sk' };
const SUPPLIER = '40000000-0000-0000-0000-000000000001';
const CREDENTIALS = { username: 'user', password: 'secret' };
const COMPANY = { id: 'i-company', scheme: 'company', value: '515301596' };
const NONPROFIT = { id: 'i-nonprofit', scheme: 'nonprofit', value: '580536878' };

// The registrar's record shape as checked 16.11.2026; GuideStar's from the 1.4 spec.
const RECORD = {
  'מספר חברה': 515301596,
  'שם חברה': 'מגנזי אורבניקס בע~מ',
  'סטטוס חברה': 'מחוסלת מרצון',
  'סוג תאגיד': 'חברה פרטית',
  'שם עיר': 'ירושלים',
};
const ORGANIZATION = {
  name: 'הסדנא',
  malkarType: 'עמותה',
  malkarStatus: 'רשומה',
  isActive: true,
  hasNihulTakin: true,
  approval46: false,
  urlGuidestar: 'https://www.guidestar.org.il/organization/580536878',
};

interface Call {
  readonly url: URL;
  readonly auth: string | null;
  readonly body: Record<string, unknown> | null;
}

interface Upstream {
  readonly input?: Response;
  readonly registrar?: Response;
  readonly organization?: Response;
  readonly save?: Response;
  /** Other data.gov.il datasets by the start of their resource id; empty when not given. */
  readonly datagov?: Record<string, Response>;
}

const EMPTY = () => Response.json({ success: true, result: { records: [] } });

function datagov(url: URL, upstream: Upstream): Response {
  const resource = url.searchParams.get('resource_id')?.slice(0, 8) ?? '';
  if (resource !== 'f004176c') return upstream.datagov?.[resource] ?? EMPTY();
  return upstream.registrar ?? Response.json({ success: true, result: { records: [RECORD] } });
}

function database(path: string, body: Record<string, unknown> | null, upstream: Upstream) {
  if (path.endsWith('registry_check_input')) {
    return upstream.input ?? Response.json({ identifiers: [COMPANY, NONPROFIT] });
  }
  return upstream.save ?? Response.json((body?.results as unknown[]).length);
}

function answer(url: URL, body: Record<string, unknown> | null, upstream: Upstream): Response {
  const path = url.pathname;
  if (path.includes('/rpc/')) return database(path, body, upstream);
  if (url.hostname === 'data.gov.il') return datagov(url, upstream);
  if (path.endsWith('/login')) return Response.json({ sessionId: 'session-1' });
  return upstream.organization ?? Response.json(ORGANIZATION);
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

function ctx(fetcher: typeof fetch, guidestar: Context['guidestar'] = CREDENTIALS): Context {
  return { env: ENV, guidestar, fetcher };
}

function post(body: unknown, token: string | null = 'user-token'): Request {
  return new Request('https://fn.test', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
}

function saved(calls: Call[]) {
  const call = calls.find((c) => c.url.pathname.endsWith('save_registry_checks'));
  return { call, results: (call?.body?.results ?? []) as Record<string, unknown>[] };
}

describe('supplier-change-check', () => {
  it('asks each registry by number and saves the answers with the service key', async () => {
    const { calls, fetcher } = fake();
    const response = await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      checked: 2,
      sources: { companies_registrar: 'ok', guidestar: 'ok', datagov: 'ok' },
    });
    const input = calls.find((c) => c.url.pathname.endsWith('registry_check_input'));
    assert.equal(input?.auth, 'Bearer user-token');
    const registrar = calls.find((c) => c.url.hostname === 'data.gov.il');
    assert.equal(registrar?.url.searchParams.get('filters'), '{"מספר חברה":515301596}');
    const organization = calls.find((c) => c.url.pathname.endsWith('/580536878'));
    assert.equal(organization?.auth, 'Bearer session-1');
    const { call, results } = saved(calls);
    assert.equal(call?.auth, 'Bearer sk');
    assert.deepEqual(results, [
      {
        id: 'i-company',
        found: true,
        name: 'מגנזי אורבניקס בע"מ',
        status: 'מחוסלת מרצון',
        details: { 'סוג תאגיד': 'חברה פרטית', checks: { registrar: 'ok', events: 'ok' } },
      },
      {
        id: 'i-nonprofit',
        found: true,
        name: 'הסדנא',
        status: 'רשומה',
        details: {
          isActive: true,
          hasNihulTakin: true,
          approval46: false,
          malkarType: 'עמותה',
          urlGuidestar: 'https://www.guidestar.org.il/organization/580536878',
          'ניהול תקין': `אין רשומה לשנת ${String(new Date().getFullYear())}`,
          checks: { guidestar: 'ok', amutot: 'ok', proper: 'ok', events: 'ok' },
        },
      },
    ]);
  });

  it('records numbers the registries do not know', async () => {
    const { calls, fetcher } = fake({
      registrar: Response.json({ success: true, result: { records: [] } }),
      organization: new Response('', { status: 404 }),
    });
    await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher));
    const results = saved(calls).results.map(({ id, found }) => ({ id, found }));
    assert.deepEqual(results, [
      { id: 'i-company', found: false },
      { id: 'i-nonprofit', found: false },
    ]);
  });

  it('marks a GuideStar body that is not active even when its status reads fine', async () => {
    const { calls, fetcher } = fake({
      input: Response.json({ identifiers: [NONPROFIT] }),
      organization: Response.json([{ ...ORGANIZATION, isActive: false }]),
    });
    await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher));
    assert.equal(saved(calls).results[0]?.status, 'רשומה - לא פעיל');
  });

  it('saves nothing for a registry that did not answer, and says which', async () => {
    const { calls, fetcher } = fake({ registrar: new Response('', { status: 500 }) });
    const response = await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher, null));
    assert.deepEqual(await response.json(), {
      checked: 0,
      sources: { companies_registrar: 'failed', guidestar: 'not_configured', datagov: 'ok' },
    });
    assert.equal(saved(calls).call, undefined);
  });

  it('uses the nonprofit registrar when GuideStar is not set up, and keeps its flags', async () => {
    const amuta = { 'מספר עמותה': 580536878, 'שם עמותה בעברית': 'הסדנא', 'סטטוס עמותה': 'נמחקה' };
    const { calls, fetcher } = fake({
      input: Response.json({ identifiers: [NONPROFIT] }),
      datagov: {
        be5b7935: Response.json({ success: true, result: { records: [amuta] } }),
        '28780ab5': Response.json({ success: false }),
      },
    });
    await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher, null));
    const [result] = saved(calls).results;
    assert.equal(result?.status, 'נמחקה');
    assert.deepEqual((result.details as { checks: unknown }).checks, {
      guidestar: 'not_configured',
      amutot: 'ok',
      proper: 'ok',
      events: 'failed',
    });
  });

  it('asks nobody when every number was checked in the last day', async () => {
    const { calls, fetcher } = fake({ input: Response.json({ identifiers: [] }) });
    const response = await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher));
    assert.deepEqual(await response.json(), { checked: 0, sources: {} });
    assert.equal(calls.length, 1);
  });

  it('passes on refusals from the database and save failures', async () => {
    for (const status of [401, 403, 404, 429]) {
      const { calls, fetcher } = fake({ input: Response.json({}, { status }) });
      const response = await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher));
      assert.equal(response.status, status);
      assert.equal(calls.length, 1);
    }
    const { fetcher } = fake({ save: Response.json({}, { status: 500 }) });
    assert.equal((await handle(post({ supplier_id: SUPPLIER }), ctx(fetcher))).status, 502);
  });

  it('rejects bad input before touching the database', async () => {
    const { calls, fetcher } = fake();
    assert.equal((await handle(post({ supplier_id: 'x' }), ctx(fetcher))).status, 400);
    assert.equal((await handle(post({ supplier_id: SUPPLIER }, null), ctx(fetcher))).status, 401);
    assert.equal((await handle(new Request('https://fn.test'), ctx(fetcher))).status, 405);
    const unset = { ...ctx(fetcher), env: null };
    assert.equal((await handle(post({ supplier_id: SUPPLIER }), unset)).status, 503);
    assert.equal(calls.length, 0);
  });
});

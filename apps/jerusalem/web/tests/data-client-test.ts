// Ported from tests/web-data.test.cjs (task R12).
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { DataClient, DataError } from '../src/data/client.ts';
import { requestBody } from './catalog-fixture.ts';

function api(fetcher: typeof fetch): DataClient {
  const pause = () => Promise.resolve();
  return new DataClient({
    baseUrl: 'https://db.test',
    publicKey: 'key',
    token: 'token',
    fetcher,
    pause,
  });
}
const url = (input: Parameters<typeof fetch>[0]) =>
  input instanceof Request ? input.url : input.toString();

it('does not report a successful insert with an empty 201 response as a failure', async () => {
  const client = api((input, init) => {
    assert.match(url(input), /supplier_names$/);
    assert.equal(new Headers(init?.headers).get('prefer'), 'return=minimal');
    return Promise.resolve(new Response(null, { status: 201 }));
  });
  await client.insert('supplier_names', { supplier_id: 'x', name: 'שם' });
});

it('rejects a write without a filter and localizes authorization errors', async () => {
  const client = api(() => Promise.resolve(new Response(null, { status: 403 })));
  await assert.rejects(client.update('suppliers', {}, { display_name: 'שם' }), /requires a filter/);
  await assert.rejects(client.remove('supplier_names', {}), /requires a filter/);
  await assert.rejects(client.list('suppliers'), /אין לך הרשאה/);
});

it('does not report a change that affected no visible rows as successful', async () => {
  const client = api(() => Promise.resolve(Response.json([])));
  await assert.rejects(
    client.update('suppliers', { id: 'eq.nope' }, { display_name: 'שם' }),
    /לא ברור אם השינוי נשמר/,
  );
});

it('calls browser fetch without the client object as its receiver', async () => {
  const client = api(function (this: unknown) {
    assert.equal(this, undefined);
    return Promise.resolve(Response.json([]));
  });
  assert.deepEqual(await client.list('suppliers'), []);
});

it('explains each error status in Hebrew', () => {
  assert.match(new DataError(401).message, /פג תוקף/);
  assert.match(new DataError(409).message, /כבר קיימת/);
  assert.match(new DataError(500).message, /תקלה במערכת/);
  assert.equal(new DataError(500).status, 500);
});

it('names the kind of each failure and whether trying again can help', () => {
  const kinds = [401, 403, 404, 409, 429, 500, 502, 503, 504, 400].map(
    (status) => new DataError(status).kind,
  );
  assert.deepEqual(kinds, [
    'session',
    'forbidden',
    'gone',
    'duplicate',
    'rate_limit',
    'system',
    'unavailable',
    'unavailable',
    'unavailable',
    'system',
  ]);
  assert.equal(new DataError(503).retryable, true);
  assert.equal(new DataError(500).retryable, false);
  assert.match(new DataError(503).message, /מסד הנתונים לא זמין/);
  assert.equal(new DataError(400, 'שדה חובה.').kind, 'rule');
});

it('reads a dead database from the PostgREST code even when the status says otherwise', async () => {
  const down = api(() => Promise.resolve(Response.json({ code: 'PGRST001' }, { status: 500 })));
  await assert.rejects(down.list('suppliers'), { kind: 'unavailable' });
});

it('tells a timeout from a server that cannot be reached', async () => {
  const slow = api(() => Promise.reject(new DOMException('late', 'TimeoutError')));
  await assert.rejects(slow.list('suppliers'), { kind: 'timeout' });
  const unreachable = api(() => Promise.reject(new TypeError('Failed to fetch')));
  await assert.rejects(unreachable.list('suppliers'), { kind: 'unavailable' });
});

it('says offline, and does not retry, when the browser has no connection', async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    let calls = 0;
    const offline = api(() => {
      calls += 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    await assert.rejects(offline.list('suppliers'), { kind: 'offline' });
    assert.equal(calls, 1);
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
  }
});

it('sends a read once more after a failure that may pass, and a write never', async () => {
  let calls = 0;
  const flaky = api(() => {
    calls += 1;
    return Promise.resolve(
      calls === 1 ? new Response(null, { status: 503 }) : Response.json([{ id: 'x' }]),
    );
  });
  assert.deepEqual(await flaky.list('suppliers'), [{ id: 'x' }]);
  assert.equal(calls, 2);
  calls = 0;
  const failing = api(() => {
    calls += 1;
    return Promise.resolve(new Response(null, { status: 503 }));
  });
  await assert.rejects(failing.rpc('create_engagement_request', { draft: {} } as never));
  assert.equal(calls, 1, 'a write is not sent twice');
  calls = 0;
  await assert.rejects(failing.rpc('load_control', {}));
  assert.equal(calls, 2, 'a read-only function is sent twice');
  calls = 0;
  const broken = api(() => {
    calls += 1;
    return Promise.resolve(new Response(null, { status: 500 }));
  });
  await assert.rejects(broken.list('suppliers'), { kind: 'system' });
  assert.equal(calls, 1, 'a fault in the system is not retried');
});

it('reports a network failure and a body that is not JSON as status 0', async () => {
  await assert.rejects(
    api(() => Promise.reject(new Error('offline'))).list('suppliers'),
    (error: unknown) => error instanceof DataError && error.status === 0,
  );
  await assert.rejects(
    api(() => Promise.resolve(new Response('<html>'))).rpc('load_control', {}),
    (error: unknown) => error instanceof DataError && error.status === 0,
  );
  await assert.rejects(api(() => Promise.resolve(Response.json({}))).list('suppliers'), DataError);
});

it('calls the unauthorized handler on 401 and returns nothing for 204', async () => {
  let cleared = 0;
  const expired = new DataClient({
    baseUrl: 'https://db.test/',
    publicKey: 'key',
    token: 'token',
    fetcher: () => Promise.resolve(new Response(null, { status: 401 })),
    onUnauthorized: () => {
      cleared += 1;
      return Promise.resolve();
    },
  });
  await assert.rejects(expired.list('suppliers'), /פג תוקף/);
  assert.equal(cleared, 1);
  const empty = api((input) => {
    assert.equal(url(input), 'https://db.test/rest/v1/rpc/load_control');
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  assert.equal(await empty.rpc('load_control', {}), null);
});

it('reads every page of a long list and orders profiles by user', async () => {
  const offsets: string[] = [];
  const client = api((input) => {
    const query = new URL(url(input)).searchParams;
    offsets.push(query.get('offset') ?? '');
    assert.equal(query.get('order'), 'user_id.asc');
    const size = query.get('offset') === '0' ? 500 : 2;
    return Promise.resolve(Response.json(Array.from({ length: size }, () => ({}))));
  });
  assert.equal((await client.list('profiles')).length, 502);
  assert.deepEqual(offsets, ['0', '500']);
});

it('returns the id of a supplier write and rejects any other answer', async () => {
  const saved = api((_input, init) => {
    assert.deepEqual(requestBody(init), { payload: { a: '1' } });
    return Promise.resolve(Response.json('id-1'));
  });
  assert.equal(await saved.supplierWrite('save_supplier_membership', { a: '1' }), 'id-1');
  const odd = api(() => Promise.resolve(Response.json({ id: 1 })));
  await assert.rejects(odd.supplierWrite('save_supplier_membership', {}), DataError);
});

it('confirms an update or a delete only when rows came back', async () => {
  const done = api(() => Promise.resolve(Response.json([{ id: 'x' }])));
  await done.update('suppliers', { id: 'eq.x' }, { display_name: 'שם' });
  await done.remove('supplier_names', { id: 'eq.x' });
  const none = api(() => Promise.resolve(Response.json({})));
  await assert.rejects(none.remove('supplier_names', { id: 'eq.x' }), /לא ברור אם השינוי נשמר/);
});

it('shows the Hebrew reason a database function gave, and keeps its status', async () => {
  const refused = api(() =>
    Promise.resolve(
      Response.json({ code: 'P0002', message: 'reason:already_decided' }, { status: 404 }),
    ),
  );
  await assert.rejects(refused.rpc('load_control', {}), {
    kind: 'reason',
    status: 404,
    message: /כבר הוחלט/,
  });
});

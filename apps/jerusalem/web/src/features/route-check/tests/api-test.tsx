// The route-check data layer, with the shared data modules replaced by mocks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataError } from '../../../data/client.ts';
import * as rpc from '../../../data/rpc.ts';
import type * as RpcModule from '../../../data/rpc.ts';
import * as site from '../../../data/site.ts';
import { replaceShortlist, shortlistIds } from '../../../lib/shortlist.ts';
import { checkRoute } from '../api/check.ts';
import { cancelRequest, loadSaved, updateRequest } from '../api/saved.ts';
import { loadEngagement, recordApproaches, saveRequest } from '../api/engagement.ts';
import type { CheckResult } from '../model/result.ts';
import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import type { Access } from '../../../data/access.ts';

vi.mock('../../../data/site.ts', () => ({
  clearCatalog: vi.fn(() => Promise.resolve()),
  detail: vi.fn(),
  getCatalogState: vi.fn(),
  refreshGrant: vi.fn(),
}));
vi.mock('../../../data/rpc.ts', async (original) => ({
  ...(await original<typeof RpcModule>()),
  identity: vi.fn(),
  requireRoles: vi.fn(),
  rows: vi.fn(),
  rpc: vi.fn(),
  sessionToken: vi.fn(() => 'token'),
  freshToken: vi.fn(() => Promise.resolve('token')),
  recoverSession: vi.fn(() => Promise.resolve(null)),
  setAdminSession: vi.fn(),
}));

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const RESULT: CheckResult = {
  id: 7,
  route: 'zuta_4',
  regulation: '8(ד)(1)',
  approver: 'ועדת המכרזים',
  status: 'ok',
  allowed: true,
  requirements: [],
  missing: [],
  warnings: [],
  comparedValue: 120000,
  increasePercent: null,
  thresholdsSource: null,
  splittingChecked: true,
};
const DRAFT_INPUT = {
  draft: { estimated_value: 100, value_includes_vat: false, requested_exemption: null },
  on: '2026-11-17',
};

function access(over: Partial<Access> = {}): Access {
  return {
    state: 'active',
    member: true,
    admin: false,
    editor: true,
    manager: false,
    grants: [{ role: 'editor', unitId: 'u1' }],
    ...over,
  };
}

function supplierDetail(id: string): SupplierDetail {
  return {
    supplier: { id, display_name: `ספק ${id.slice(-1)}`, status: 'active' },
    contacts: [{ kind: 'email', value: 'a@x.test', is_valid: true }],
  } as unknown as SupplierDetail;
}

function request(url: string) {
  return { request: new Request(url), params: {}, context: undefined } as never;
}

beforeEach(() => {
  window.sessionStorage.clear();
  replaceShortlist([]);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('loadEngagement', () => {
  it('refuses a user who is not an active member', async () => {
    vi.mocked(rpc.identity).mockResolvedValue({
      userId: 'x',
      access: access({ member: false }),
    });
    await expect(loadEngagement(request('https://site.test/'))).rejects.toMatchObject({
      status: 403,
    });
    vi.mocked(rpc.identity).mockResolvedValue({
      userId: 'x',
      access: access({ state: 'pending' }),
    });
    await expect(loadEngagement(request('https://site.test/'))).rejects.toBeInstanceOf(DataError);
  });

  it('loads nothing for an empty list and keeps only units the user may write in', async () => {
    vi.mocked(rpc.identity).mockResolvedValue({ userId: 'x', access: access() });
    vi.mocked(site.getCatalogState).mockReturnValue({
      catalog: {
        units: [
          { id: 'u1', name: 'א' },
          { id: 'u2', name: 'ב' },
        ],
      },
    } as never);
    const value = await loadEngagement(request('https://site.test/'));
    expect(value.suppliers).toEqual([]);
    expect(value.units).toEqual([{ id: 'u1', name: 'א' }]);
    expect(value.today).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it('opens a shared list, skips suppliers that fail to load and adds the last approach', async () => {
    vi.mocked(rpc.identity).mockResolvedValue({ userId: 'x', access: access() });
    vi.mocked(site.getCatalogState).mockReturnValue(null);
    vi.mocked(site.detail).mockImplementation((_token, id) =>
      id === A ? Promise.resolve(supplierDetail(A)) : Promise.reject(new Error('gone')),
    );
    vi.mocked(rpc.rpc).mockResolvedValue([{ supplier_id: A, last_on: '2026-10-01' }]);
    const value = await loadEngagement(
      request(`https://site.test/engagement?suppliers=${A},${B},not-an-id`),
    );
    expect(shortlistIds()).toEqual([A, B]);
    expect(rpc.rpc).toHaveBeenCalledWith(
      'last_approaches',
      { suppliers: [A, B] },
      expect.anything(),
    );
    expect(value.units).toEqual([]);
    expect(value.suppliers).toEqual([
      {
        id: A,
        name: 'ספק 1',
        inactive: false,
        emails: ['a@x.test'],
        phones: [],
        lastApproached: '2026-10-01',
      },
    ]);
  });

  it('uses the list picked in this tab when the link names no suppliers', async () => {
    replaceShortlist([B]);
    vi.mocked(rpc.identity).mockResolvedValue({ userId: 'x', access: access({ admin: true }) });
    vi.mocked(site.getCatalogState).mockReturnValue({ catalog: { units: [] } } as never);
    vi.mocked(site.detail).mockResolvedValue(supplierDetail(B));
    vi.mocked(rpc.rpc).mockResolvedValue([]);
    const value = await loadEngagement(request('https://site.test/engagement'));
    expect(value.suppliers[0]?.lastApproached).toBeNull();
  });
});

describe('engagement writes', () => {
  it('saves a request and records approaches through the database functions', async () => {
    vi.mocked(rpc.rpc).mockResolvedValueOnce('req-1').mockResolvedValueOnce(2);
    const draft = { ...DRAFT_INPUT.draft, unit_id: 'u1', subject: 'ייעוץ' };
    expect(await saveRequest(draft)).toBe('req-1');
    const approaching = { request: 'req-1', suppliers: [A, B], channel: 'portal' as const };
    expect(await recordApproaches({ ...approaching, respondBy: '2026-11-24' })).toBe(2);
    expect(rpc.rpc).toHaveBeenNthCalledWith(
      1,
      'create_engagement_request',
      { draft },
      expect.anything(),
    );
    expect(rpc.rpc).toHaveBeenNthCalledWith(
      2,
      'record_supplier_approaches',
      { ...approaching, respond_by: '2026-11-24' },
      expect.anything(),
    );
  });
});

describe('loadSaved', () => {
  const editor = { userId: 'u', access: access() };

  it('shows nothing to a viewer, and asks the database nothing', async () => {
    const viewer = access({ editor: false, grants: [{ role: 'viewer', unitId: 'u1' }] });
    expect(await loadSaved({ userId: 'u', access: viewer })).toBeNull();
    expect(rpc.rows).not.toHaveBeenCalled();
  });

  it('lists open requests newest first with the state of their latest check', async () => {
    const request = (id: string) => ({
      id,
      unit_id: 'u1',
      subject: id,
      estimated_value: 1,
      value_includes_vat: false,
      requested_exemption: null,
      status: 'draft',
      created_at: '2026-11-17T10:00:00Z',
      updated_at: id === 'c' ? '2026-11-17T12:00:00Z' : '2026-11-17T10:00:00Z',
    });
    vi.mocked(rpc.rows)
      .mockResolvedValueOnce([request('a'), request('b'), request('c')])
      .mockResolvedValueOnce([
        { request_id: 'a', status: 'blocked', created_at: '2026-11-17T11:00:00Z' },
        { request_id: 'c', status: 'ok', created_at: '2026-11-17T11:00:00Z' },
        { request_id: 'a', status: 'ok', created_at: '2026-11-17T10:30:00Z' },
      ]);
    const value = await loadSaved(editor);
    expect(rpc.rows).toHaveBeenNthCalledWith(
      1,
      'engagement_requests',
      { status: 'not.in.(cancelled,rejected,contracted)', order: 'created_at.desc' },
      expect.anything(),
    );
    expect(rpc.rows).toHaveBeenNthCalledWith(
      2,
      'route_checks',
      { request_id: 'in.(a,b,c)', order: 'created_at.desc' },
      expect.anything(),
    );
    expect(value?.map((r) => [r.id, r.lastStatus, r.changedSinceCheck])).toEqual([
      ['a', 'blocked', false],
      ['b', null, false],
      ['c', 'ok', true],
    ]);
  });

  it('skips the checks query when there are no requests', async () => {
    vi.mocked(rpc.rows).mockResolvedValueOnce([]);
    expect(await loadSaved(editor)).toEqual([]);
    expect(rpc.rows).toHaveBeenCalledOnce();
  });
});

describe('changing a saved request', () => {
  const details = {
    subject: 'ייעוץ',
    estimated_value: 5,
    value_includes_vat: true,
    requested_exemption: null,
  };

  it('sends the new details and the cancel reason to their functions', async () => {
    vi.mocked(rpc.rpc).mockResolvedValue(null);
    await updateRequest('r1', details);
    await cancelRequest('r1', 'לא רלוונטי');
    expect(rpc.rpc).toHaveBeenNthCalledWith(
      1,
      'update_engagement_request',
      { request: 'r1', draft: details },
      expect.anything(),
    );
    expect(rpc.rpc).toHaveBeenNthCalledWith(
      2,
      'cancel_engagement_request',
      { request: 'r1', note: 'לא רלוונטי' },
      expect.anything(),
    );
  });
});

describe('checkRoute', () => {
  const ok = () => Promise.resolve(Response.json(RESULT));

  it('posts the checked input with the session token and returns the result', async () => {
    const fetcher = vi.fn(ok);
    expect(await checkRoute(DRAFT_INPUT, fetcher)).toEqual(RESULT);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/route-check$/u);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    expect(JSON.parse(init.body as string)).toEqual(DRAFT_INPUT);
  });

  it('rejects invalid input before calling the server', async () => {
    const fetcher = vi.fn(ok);
    await expect(checkRoute({ ...DRAFT_INPUT, on: '17.11.2026' }, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports a network failure, a bad body and an invalid result as status 0', async () => {
    await expect(
      checkRoute(DRAFT_INPUT, () => Promise.reject(new Error('x'))),
    ).rejects.toMatchObject({ status: 0 });
    const notJson = () => Promise.resolve(new Response('<html>', { status: 200 }));
    await expect(checkRoute(DRAFT_INPUT, notJson)).rejects.toMatchObject({ status: 0 });
    const wrong = () => Promise.resolve(Response.json({ ...RESULT, allowed: false }));
    await expect(checkRoute(DRAFT_INPUT, wrong)).rejects.toMatchObject({ status: 0 });
  });

  it.each([
    [404, 'הבקשה כבר לא קיימת'],
    [422, 'אין סף מכרז מאושר לתאריך הזה'],
    [429, 'בוצעו יותר מדי פעולות בזמן קצר'],
  ])('explains status %i in Hebrew', async (status, message) => {
    const fetcher = () => Promise.resolve(new Response(null, { status }));
    await expect(checkRoute(DRAFT_INPUT, fetcher)).rejects.toThrow(message);
  });

  it('tells a database that is down from a fault in the system (18.11 incident)', async () => {
    const down = () =>
      Promise.resolve(Response.json({ error: 'Database unavailable' }, { status: 502 }));
    await expect(checkRoute(DRAFT_INPUT, down)).rejects.toMatchObject({ kind: 'unavailable' });
    const unsaved = () => Promise.resolve(Response.json({ error: 'system' }, { status: 502 }));
    await expect(checkRoute(DRAFT_INPUT, unsaved)).rejects.toMatchObject({
      kind: 'system',
      message: expect.stringMatching(/תקלה במערכת/u) as unknown,
    });
  });

  it('keeps the general message for other errors', async () => {
    const fetcher = () => Promise.resolve(new Response(null, { status: 500 }));
    const error: unknown = await checkRoute(DRAFT_INPUT, fetcher).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toBe(new DataError(500).message);
  });

  it('renews the session, or signs out, when the server rejects the token', async () => {
    vi.mocked(rpc.recoverSession).mockRejectedValueOnce(new Error('offline'));
    const fetcher = () => Promise.resolve(new Response(null, { status: 401 }));
    await expect(checkRoute(DRAFT_INPUT, fetcher)).rejects.toMatchObject({ status: 401 });
    expect(rpc.recoverSession).toHaveBeenCalledWith('token');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as RpcModule from '../../../data/rpc.ts';
import * as rpc from '../../../data/rpc.ts';
import * as snapshot from '../../../data/snapshot.ts';
import * as site from '../../../data/site.ts';
import type { Access } from '../../../data/access.ts';
import { changeSummary, detailsText, grantLabel } from '../../../data/access-change-labels.ts';
import {
  askChange,
  askDetails,
  cancelChange,
  lastSignIn,
  loadAccount,
  requestAccess,
} from '../api/account.ts';
import type { ChangeRequest } from '../api/account.ts';

vi.mock('../../../data/rpc.ts', async (original) => ({
  ...(await original<typeof RpcModule>()),
  rows: vi.fn(() => Promise.resolve([])),
  rpc: vi.fn(() => Promise.resolve(null)),
  insertProfile: vi.fn(() => Promise.resolve()),
  sessionToken: vi.fn(() => 'token'),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const access = (state: Access['state']): Access => ({
  state,
  member: state === 'active',
  admin: false,
  editor: false,
  manager: false,
  grants: [],
});
const tables = () => vi.mocked(rpc.rows).mock.calls.map((call) => call[0]);

describe('account loader', () => {
  it('reads only departments for someone without a profile', async () => {
    const account = await loadAccount({ userId: 'me', access: access('unregistered') });
    expect(tables()).toEqual(['org_units']);
    expect(account).toEqual({
      profile: null,
      units: [],
      grants: [],
      changes: null,
      signedInAt: null,
      admin: false,
    });
  });
  it('reads only the profile while the request waits', async () => {
    await loadAccount({ userId: 'me', access: access('pending') });
    expect(vi.mocked(rpc.rows).mock.calls[0]?.slice(0, 2)).toEqual([
      'profiles',
      { user_id: 'eq.me' },
    ]);
    expect(tables()).toEqual(['profiles']);
  });
  it('reads units, own roles and own requests for an active user', async () => {
    const account = await loadAccount({ userId: 'me', access: access('active') });
    expect(tables()).toEqual(['profiles', 'org_units', 'role_grants', 'access_change_requests']);
    expect(account.changes).toEqual([]);
  });
  it('treats a missing change-request table as not available', async () => {
    vi.mocked(rpc.rows).mockImplementation((table) =>
      table === 'access_change_requests' ? Promise.reject(new Error('404')) : Promise.resolve([]),
    );
    expect((await loadAccount({ userId: 'me', access: access('active') })).changes).toBeNull();
  });
});

describe('last sign-in', () => {
  it('reads it from Supabase Auth and leaves it out on any failure', async () => {
    const user = vi.spyOn(site, 'authUser');
    user.mockResolvedValueOnce(Response.json({ last_sign_in_at: '2026-11-18T06:55:00Z' }));
    expect(await lastSignIn()).toBe('2026-11-18T06:55:00Z');
    user.mockResolvedValueOnce(Response.json({}));
    expect(await lastSignIn()).toBeNull();
    user.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await lastSignIn()).toBeNull();
    user.mockRejectedValueOnce(new Error('offline'));
    expect(await lastSignIn()).toBeNull();
    user.mockRestore();
  });
});

describe('account writes', () => {
  const input = {
    first_name: 'דנה',
    last_name: 'כהן',
    job_title: 'מהנדסת',
    unit_id: 'u1',
    phone: null,
    purpose: 'איתור יועצים',
  };
  it('signs up with the email of the signed-in account', async () => {
    vi.spyOn(snapshot, 'tokenEmail').mockReturnValue('dana@example.test');
    await requestAccess('me', input);
    expect(rpc.insertProfile).toHaveBeenCalledWith({
      user_id: 'me',
      email: 'dana@example.test',
      ...input,
    });
  });
  it('refuses to sign up without an email in the session', async () => {
    vi.spyOn(snapshot, 'tokenEmail').mockReturnValue(null);
    await expect(requestAccess('me', input)).rejects.toThrow(/דוא״ל/);
    expect(rpc.insertProfile).not.toHaveBeenCalled();
  });
  it('sends only the fields each kind of change needs', async () => {
    const base = { role: 'editor' as const, unit_id: 'u1', grant_id: 'g1', reason: 'סיבה טובה' };
    await askChange({ ...base, kind: 'add_role' });
    await askChange({ ...base, kind: 'move_unit' });
    await askChange({ ...base, kind: 'remove_role' });
    await askChange({ ...base, role: '', unit_id: '', kind: 'add_role' });
    expect(vi.mocked(rpc.rpc).mock.calls.map((call) => call[1])).toEqual([
      {
        change_kind: 'add_role',
        why: 'סיבה טובה',
        wanted_role: 'editor',
        target_unit: 'u1',
        target_grant: null,
      },
      {
        change_kind: 'move_unit',
        why: 'סיבה טובה',
        wanted_role: null,
        target_unit: 'u1',
        target_grant: null,
      },
      {
        change_kind: 'remove_role',
        why: 'סיבה טובה',
        wanted_role: null,
        target_unit: null,
        target_grant: 'g1',
      },
      {
        change_kind: 'add_role',
        why: 'סיבה טובה',
        wanted_role: null,
        target_unit: null,
        target_grant: null,
      },
    ]);
  });
  it('asks for details and cancels through the database functions', async () => {
    await askDetails({ phone: '02-6297777' }, 'מספר חדש');
    await cancelChange('c1');
    expect(vi.mocked(rpc.rpc).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [
        'request_access_change',
        { change_kind: 'details', why: 'מספר חדש', new_details: { phone: '02-6297777' } },
      ],
      ['cancel_access_change', { request_id: 'c1' }],
    ]);
  });
});

describe('change labels', () => {
  const units = new Map([['u1', 'אגף החינוך']]);
  const grants = [{ id: 'g1', role: 'editor' as const, unit_id: 'u1' }];
  const change = (over: Partial<ChangeRequest>): ChangeRequest => ({
    id: 'c',
    kind: 'add_role',
    role: null,
    unit_id: null,
    grant_id: null,
    details: null,
    reason: 'סיבה',
    status: 'pending',
    created_at: '2026-11-18T08:00:00Z',
    decided_at: null,
    decision_note: null,
    ...over,
  });
  it('names roles with their unit, except admin and auditor', () => {
    expect(grantLabel({ role: 'admin', unit_id: null }, units)).toBe('מנהל מערכת');
    expect(grantLabel({ role: 'viewer', unit_id: 'gone' }, units)).toBe('צופה · יחידה לא זמינה');
  });
  it('says in one line what a request asks for', () => {
    expect(changeSummary(change({ role: 'auditor' }), units, grants)).toBe('תפקיד נוסף: מבקר');
    expect(changeSummary(change({}), units, grants)).toBe('תפקיד נוסף');
    expect(changeSummary(change({ kind: 'remove_role', grant_id: 'g1' }), units, grants)).toBe(
      'הסרת תפקיד: עורך · אגף החינוך',
    );
    expect(changeSummary(change({ kind: 'remove_role', grant_id: 'x' }), units, grants)).toBe(
      'הסרת תפקיד',
    );
    expect(changeSummary(change({ kind: 'move_unit' }), units, grants)).toBe(
      'מעבר יחידה: יחידה לא זמינה',
    );
    expect(changeSummary(change({ kind: 'details' }), units, grants)).toBe('עדכון פרטים: ');
    expect(detailsText({ phone: '', other: 'x' })).toBe('טלפון: ללא · other: x');
    expect(detailsText(null)).toBe('');
  });
});

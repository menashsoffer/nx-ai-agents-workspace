// The thin data layers of the admin screens, with the shared RPC helpers mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataError } from '../src/data/client.ts';
import * as rpc from '../src/data/rpc.ts';
import * as screenData from '../src/data/screen-data.ts';
import type * as RpcModule from '../src/data/rpc.ts';
import { decideRequest, loadRequests } from '../src/features/categories/api/requests.ts';
import { decideCandidate, loadCandidates } from '../src/features/identifiers/api/candidates.ts';
import { decide } from '../src/features/identifiers/api/decision.ts';
import { loadControl } from '../src/features/load-control/api/control.ts';
import { decideProposal, loadProposals } from '../src/features/thresholds/api/proposals.ts';
import { decideReview } from '../src/features/users/api/review.ts';
import {
  addGrant,
  approveProfile,
  loadUsers,
  removeGrant,
} from '../src/features/users/api/users.ts';
import { decideChange } from '../src/features/users/api/changes.ts';

vi.mock('../src/data/rpc.ts', async (original) => ({
  ...(await original<typeof RpcModule>()),
  requireRoles: vi.fn(() => Promise.resolve({ userId: 'admin-1', access: {} })),
  rows: vi.fn(() => Promise.resolve([])),
  rpc: vi.fn(() => Promise.resolve(null)),
}));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** The next reload of the screen fails, so the write says the list may be out of date. */
const failRefresh = () =>
  vi.spyOn(screenData, 'refreshScreen').mockRejectedValueOnce(new Error('refresh failed'));

afterEach(() => {
  vi.clearAllMocks();
});

describe('loaders check the role and read the right rows', () => {
  it('users', async () => {
    const value = await loadUsers();
    expect(rpc.requireRoles).toHaveBeenCalledWith(['admin', 'unit_manager']);
    expect(vi.mocked(rpc.rows).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['profiles', {}],
      ['role_grants', { revoked_at: 'is.null' }],
      ['org_units', { active: 'eq.true' }],
      [
        'access_change_requests',
        { status: 'eq.pending', user_id: 'neq.admin-1', order: 'created_at.asc' },
      ],
    ]);
    expect(value.changes).toEqual([]);
    expect(value.who.userId).toBe('admin-1');
    expect(typeof value.now).toBe('number');
  });

  it('users without the change-request table', async () => {
    vi.mocked(rpc.rows).mockImplementation((table) =>
      table === 'access_change_requests' ? Promise.reject(new Error('404')) : Promise.resolve([]),
    );
    expect((await loadUsers()).changes).toBeNull();
  });

  it('approves with a role in one step, or the old way while that is not deployed', async () => {
    const viewer = { userId: 'u', role: 'viewer' as const, unit: 'a', requestUnit: 'a' };
    await approveProfile({ ...viewer, role: 'editor' });
    expect(vi.mocked(rpc.rpc).mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'approve_profile',
      { target_user: 'u', wanted_role: 'editor', target_unit: 'a', note: null },
    ]);
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(404));
    await approveProfile(viewer);
    expect(vi.mocked(rpc.rpc).mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'decide_profile',
      { target_user: 'u', decision: 'active', note: null },
    ]);
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(404));
    await expect(approveProfile({ ...viewer, role: 'editor' })).rejects.toThrow();
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(403));
    await expect(approveProfile(viewer)).rejects.toThrow();
  });

  it('decides a change request, sending an empty note as none', async () => {
    await decideChange('c1', false, 'אין צורך');
    await decideChange('c2', true, '');
    expect(vi.mocked(rpc.rpc).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['decide_access_change', { request_id: 'c1', approve: false, note: 'אין צורך' }],
      ['decide_access_change', { request_id: 'c2', approve: true, note: null }],
    ]);
  });

  it('category requests', async () => {
    expect((await loadRequests()).userId).toBe('admin-1');
    expect(rpc.requireRoles).toHaveBeenCalledWith(['admin']);
    expect(vi.mocked(rpc.rows).mock.calls[0]?.slice(0, 2)).toEqual([
      'category_requests',
      { status: 'eq.pending' },
    ]);
  });

  it('identifier candidates', async () => {
    expect(await loadCandidates()).toEqual({ candidates: [], kinds: [], suppliers: [] });
    expect(rpc.requireRoles).toHaveBeenCalledWith(['admin']);
  });

  it('threshold proposals', async () => {
    expect(await loadProposals()).toEqual({ proposals: [], thresholds: [] });
    expect(rpc.requireRoles).toHaveBeenCalledWith(['admin']);
  });

  it('load control', async () => {
    vi.mocked(rpc.rpc).mockResolvedValueOnce({ jobs: [] });
    expect(await loadControl()).toEqual({ jobs: [] });
    expect(rpc.requireRoles).toHaveBeenCalledWith(['admin', 'auditor']);
    expect(vi.mocked(rpc.rpc).mock.calls.map((call) => call[0])).toEqual(['load_control']);
  });
});

describe('writes go to their database function', () => {
  it('sends grants, revocations, candidates and proposals', async () => {
    await addGrant({ target_user: 'u', wanted_role: 'editor', target_unit: null });
    await removeGrant('g1');
    await decideCandidate('c1', true);
    await decideProposal('p1', false, 'סיבה');
    expect(vi.mocked(rpc.rpc).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['grant_role', { target_user: 'u', wanted_role: 'editor', target_unit: null }],
      ['revoke_role', { grant_id: 'g1' }],
      ['decide_identifier_candidate', { candidate: 'c1', accept: true }],
      ['decide_threshold_proposal', { proposal: 'p1', approve: false, note: 'סיבה' }],
    ]);
  });
  it('decides a proposal without the reason where the database is not migrated yet', async () => {
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(404));
    await decideProposal('p1', false, 'סיבה');
    expect(vi.mocked(rpc.rpc).mock.calls.map((call) => call[1])).toEqual([
      { proposal: 'p1', approve: false, note: 'סיבה' },
      { proposal: 'p1', approve: false },
    ]);
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(403));
    await expect(decideProposal('p1', true)).rejects.toThrow(DataError);
  });
});

describe('profile review', () => {
  it('requires a decision and a note for a rejection', async () => {
    expect((await decideReview('u', form({}))).error).toBe('יש לבחור החלטה.');
    expect((await decideReview('u', form({ decision: 'rejected' }))).fieldError).not.toBe('');
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it('saves an approval with an empty note as null', async () => {
    expect(await decideReview('u', form({ decision: 'active', note: '  ' }))).toEqual({
      error: '',
      fieldError: '',
      committed: true,
    });
    expect(vi.mocked(rpc.rpc).mock.calls[0]?.[1]).toEqual({
      target_user: 'u',
      decision: 'active',
      note: null,
    });
  });

  it('reports a refused save and a list that did not refresh', async () => {
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(403));
    const refused = await decideReview('u', form({ decision: 'active' }));
    expect(refused.error).toBe(new DataError(403).message);
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new Error('x'));
    const failed = await decideReview('u', form({ decision: 'active' }));
    expect(failed.error).toMatch(/תקלה במערכת/u);
    failRefresh();
    const stale = await decideReview('u', form({ decision: 'active' }));
    expect(stale.committed).toBe(true);
    expect(stale.error).toMatch(/נשמרה/u);
  });
});

describe('identifier decision', () => {
  it('requires a decision', async () => {
    expect((await decide('c', form({}))).error).toBe('יש לבחור החלטה.');
  });

  it('accepts or dismisses, and says when the list did not refresh', async () => {
    expect((await decide('c', form({ decision: 'accept' }))).message).toMatch(/לבדיקה נוספת/u);
    failRefresh();
    const dismissed = await decide('c', form({ decision: 'dismiss' }));
    expect(dismissed.message).toBe('המועמד נדחה. יש לרענן את הרשימה לפני פעולה נוספת.');
  });

  it('treats a candidate someone else decided as done, and reports other errors', async () => {
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(404));
    expect((await decide('c', form({ decision: 'accept' }))).message).toBe('המועמד כבר טופל.');
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(403));
    expect((await decide('c', form({ decision: 'accept' }))).error).toBe(
      new DataError(403).message,
    );
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new Error('x'));
    expect((await decide('c', form({ decision: 'accept' }))).committed).toBe(false);
  });
});

describe('category request decision', () => {
  const approve = { decision: 'approved', note: 'מתאים' };

  it('returns the form error without saving', async () => {
    expect(await decideRequest('r', form({}))).toMatchObject({ committed: false });
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it('saves, refreshes, and says when the refresh failed', async () => {
    expect(await decideRequest('r', form(approve))).toEqual({
      error: '',
      field: {},
      committed: true,
    });
    failRefresh();
    expect((await decideRequest('r', form(approve))).error).toMatch(/נשמרה/u);
  });

  it('refreshes when another admin already decided, and reports other errors', async () => {
    const refresh = failRefresh();
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(404));
    expect((await decideRequest('r', form(approve))).error).toBe('הבקשה כבר טופלה. הרשימה רועננה.');
    expect(refresh).toHaveBeenCalledOnce();
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new DataError(403));
    expect((await decideRequest('r', form(approve))).error).toBe(new DataError(403).message);
    vi.mocked(rpc.rpc).mockRejectedValueOnce(new Error('x'));
    expect((await decideRequest('r', form(approve))).error).toMatch(/תקלה במערכת/u);
  });
});

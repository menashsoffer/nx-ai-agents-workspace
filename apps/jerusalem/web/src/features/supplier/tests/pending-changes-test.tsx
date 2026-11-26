import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as rpc from '../../../data/rpc.ts';
import * as screenData from '../../../data/screen-data.ts';
import type { ChangeRequest } from '../../../data/supplier-changes.ts';
import { PendingChanges } from '../components/pending-changes.tsx';
import { loadPendingChanges } from '../api/changes.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ME = 'me';
function request(extra: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'r1',
    supplier_id: 's1',
    change_kind: 'contact',
    contact_kind: 'phone',
    old_value: '026291111',
    new_value: '026291112',
    reason: null,
    checks: [{ check: 'shared_contact', outcome: 'yellow', name: 'אלון' }],
    created_at: '2026-11-22T08:00:00Z',
    created_by: 'other',
    ...extra,
  };
}

describe('waiting supplier changes', () => {
  it('says when the supplier proposed the change from its personal area', () => {
    render(
      <PendingChanges
        changes={[request({ origin: 'supplier' })]}
        userId={ME}
        admin={false}
        editor
      />,
    );
    expect(screen.getByText(/הספק הציע ב-/)).toBeDefined();
  });

  it('shows nothing when no change waits', () => {
    const { container } = render(<PendingChanges changes={[]} userId={ME} admin={false} editor />);
    expect(container.textContent).toBe('');
  });

  it('lets another editor approve a contact change, and asks for a reason to reject', async () => {
    const call = vi.spyOn(rpc, 'rpc').mockResolvedValue(null);
    vi.spyOn(screenData, 'invalidate').mockResolvedValue();
    render(<PendingChanges changes={[request()]} userId={ME} admin={false} editor />);
    expect(screen.getByRole('heading', { name: /טלפון: 026291111 ← 026291112/ })).toBeDefined();
    expect(screen.getByText(/רשום גם אצל אלון/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'דחייה' }));
    expect(await screen.findByText('צריך לכתוב סיבה לדחייה.')).toBeDefined();
    expect(call).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await vi.waitFor(() => {
      expect(call).toHaveBeenCalledWith(
        'decide_supplier_change',
        { request_id: 'r1', approve: true, note: null },
        expect.anything(),
      );
    });
    expect(screenData.invalidate).toHaveBeenCalledWith(['supplier', 's1']);
  });

  it('leaves a name change to an admin and lets its owner cancel it', async () => {
    const call = vi.spyOn(rpc, 'rpc').mockRejectedValue(new Error('כבר הוחלט.'));
    vi.spyOn(screenData, 'invalidate').mockResolvedValue();
    const rename = request({ change_kind: 'rename', contact_kind: null, reason: 'כתיב' });
    const { rerender } = render(
      <PendingChanges changes={[rename]} userId={ME} admin={false} editor />,
    );
    expect(screen.getByText(/הסיבה: כתיב/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'אישור' })).toBeNull();
    rerender(<PendingChanges changes={[{ ...rename, created_by: ME }]} userId={ME} admin editor />);
    expect(screen.getByText(/הבקשה שלך/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'ביטול הבקשה' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(call.mock.calls[0]?.[0]).toBe('cancel_supplier_change');
  });

  it('loads the waiting changes of one supplier, oldest first', async () => {
    const rows = vi.spyOn(rpc, 'rows').mockResolvedValue([]);
    await loadPendingChanges('s1');
    expect(rows.mock.calls[0]?.slice(0, 2)).toEqual([
      'supplier_change_requests',
      { supplier_id: 'eq.s1', status: 'eq.pending', order: 'created_at.asc' },
    ]);
  });
});

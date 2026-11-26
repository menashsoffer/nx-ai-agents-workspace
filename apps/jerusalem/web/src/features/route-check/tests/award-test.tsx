// Stage C (25.11): an opened offer can be chosen as the winner, which closes the request.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as rpc from '../../../data/rpc.ts';
import * as api from '../api/approaches.ts';
import type { RequestApproach } from '../api/approaches.ts';
import { RequestApproaches } from '../components/request-approaches.tsx';

const offer = (amount: number | null) => ({
  id: 'x',
  answer: 'offer' as const,
  decline_reason: null,
  source: 'staff' as const,
  received_on: '2026-11-20',
  created_at: '2026-11-20T10:00:00Z',
  offer_amount: amount,
  offer_includes_vat: amount === null ? null : true,
});
const row = (id: string, sealed: boolean, amount: number | null): RequestApproach => ({
  id,
  supplier_id: id,
  supplier_name: `ספק ${id}`,
  channel: 'email',
  approached_on: '2026-11-10',
  respond_by: '2026-11-21',
  sealed,
  answer: offer(amount),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('choosing the winner', () => {
  it('offers only opened offers, and closes the request with the reason', async () => {
    vi.spyOn(api, 'loadRequestApproaches').mockResolvedValue([
      row('a', false, 1000),
      row('b', true, null),
    ]);
    const call = vi.spyOn(rpc, 'rpc').mockResolvedValue(null);
    render(<RequestApproaches requestId="r1" today="2026-11-24" status="submitted" />);
    await userEvent.click(await screen.findByRole('button', { name: 'בחירת ספק a כזוכה' }));
    expect(screen.queryByRole('button', { name: 'בחירת ספק b כזוכה' })).toBeNull();
    const form = screen.getByRole('form', { name: 'בחירת ספק a כזוכה' });
    await userEvent.type(within(form).getByLabelText(/נימוק/u), 'הזולה ביותר');
    await userEvent.click(within(form).getByRole('button', { name: 'בחירה כזוכה' }));
    expect(call).toHaveBeenCalledWith(
      'award_engagement_request',
      { request: 'r1', approach: 'a', note: 'הזולה ביותר' },
      expect.anything(),
    );
    expect(await screen.findByText('ספק a נבחר כזוכה, והבקשה נסגרה.')).toBeDefined();
  });

  it('shows the refusal and lets the form be closed', async () => {
    vi.spyOn(api, 'loadRequestApproaches').mockResolvedValue([row('a', false, 1000)]);
    vi.spyOn(rpc, 'rpc').mockRejectedValue(new Error('reason:approach_award_offer'));
    render(<RequestApproaches requestId="r1" today="2026-11-24" status="submitted" />);
    await userEvent.click(await screen.findByRole('button', { name: 'בחירת ספק a כזוכה' }));
    const form = screen.getByRole('form', { name: 'בחירת ספק a כזוכה' });
    await userEvent.type(within(form).getByLabelText(/נימוק/u), 'x'.repeat(10));
    await userEvent.click(within(form).getByRole('button', { name: 'בחירה כזוכה' }));
    expect(await within(form).findByRole('alert')).toBeDefined();
    await userEvent.click(within(form).getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('form', { name: 'בחירת ספק a כזוכה' })).toBeNull();
  });

  it('shows an awarded request without actions', async () => {
    vi.spyOn(api, 'loadRequestApproaches').mockResolvedValue([row('a', false, 1000)]);
    render(<RequestApproaches requestId="r1" today="2026-11-24" status="awarded" />);
    expect(await screen.findByText('נבחר זוכה, והבקשה נסגרה.')).toBeDefined();
    expect(screen.queryByRole('button', { name: /כזוכה/u })).toBeNull();
  });
});

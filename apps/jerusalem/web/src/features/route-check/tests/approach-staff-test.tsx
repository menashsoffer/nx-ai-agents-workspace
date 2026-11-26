// supplier-approaches-spec-he.md 6.2 and 6.3: staff record an answer that came outside the
// area, and move every open deadline forward with a reason.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as rpc from '../../../data/rpc.ts';
import { refusal } from '../../../data/client.ts';
import * as api from '../api/approaches.ts';
import type { RequestApproach } from '../api/approaches.ts';
import { RequestApproaches } from '../components/request-approaches.tsx';
import '../model/approach-reasons.ts';
import { amountProblem, extendRange, receivedRange, recordable } from '../model/approaches.ts';

const TODAY = '2026-11-24';
const row = (id: string, more: Partial<RequestApproach> = {}): RequestApproach => ({
  id,
  supplier_id: id,
  supplier_name: `ספק ${id}`,
  channel: 'email',
  approached_on: '2026-11-22',
  respond_by: '2026-11-29',
  sealed: true,
  answer: null,
  ...more,
});
const declined = {
  id: 'x',
  answer: 'declined' as const,
  decline_reason: 'too_short',
  source: 'staff' as const,
  received_on: TODAY,
  created_at: '2026-11-24T08:00:00Z',
};

function show(list: RequestApproach[]) {
  const load = vi.spyOn(api, 'loadRequestApproaches').mockResolvedValue(list);
  render(<RequestApproaches requestId="r1" today={TODAY} status="submitted" />);
  return load;
}
const submit = (name: string) => userEvent.click(screen.getByRole('button', { name }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('staff approach rules', () => {
  it('records answers only for open approaches outside the area', () => {
    expect(recordable(row('a'), TODAY)).toBe(true);
    expect(recordable(row('a', { respond_by: null }), TODAY)).toBe(true);
    expect(recordable(row('a', { channel: 'portal' }), TODAY)).toBe(false);
    expect(recordable(row('a', { answer: declined }), TODAY)).toBe(false);
    expect(recordable(row('a', { respond_by: '2026-11-23' }), TODAY)).toBe(false);
    expect(receivedRange(row('a'), TODAY)).toEqual({ min: '2026-11-22', max: TODAY });
    expect(receivedRange(row('a', { respond_by: '2026-11-23' }), TODAY).max).toBe('2026-11-23');
  });

  it('moves a deadline only past the latest open one', () => {
    const list = [row('a'), row('b', { respond_by: '2026-12-01' }), row('c', { sealed: false })];
    expect(extendRange(list, TODAY)).toEqual({ min: '2026-12-02', max: '2027-02-22' });
    expect(extendRange([row('a', { respond_by: TODAY })], TODAY)?.min).toBe('2026-11-25');
    expect(extendRange([row('a', { sealed: false })], TODAY)).toBeNull();
    expect(amountProblem('1,200.50')).toBeNull();
    expect(amountProblem('0')).not.toBeNull();
    expect(amountProblem('1.234')).not.toBeNull();
  });
});

describe('recording an answer', () => {
  it('records an email offer once it is complete, and reloads the list', async () => {
    const call = vi.spyOn(rpc, 'rpc').mockResolvedValue(null);
    const load = show([row('a'), row('b', { channel: 'portal' })]);
    expect(await screen.findByText('ספק b')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'רישום תשובה של ספק b' })).toBeNull();
    await submit('רישום תשובה של ספק a');
    const form = screen.getByRole('form', { name: 'רישום תשובה של ספק a' });
    expect(document.activeElement).toBe(screen.getByLabelText('מה הספק ענה'));
    await submit('רישום התשובה');
    expect(await screen.findByText('בחרו מה הספק ענה.')).toBeDefined();
    await userEvent.selectOptions(screen.getByLabelText('מה הספק ענה'), 'offer');
    await userEvent.type(screen.getByLabelText('הסכום בש״ח'), '1,200.5');
    await submit('רישום התשובה');
    expect(await screen.findByText('בחרו אם הסכום כולל מע״מ.')).toBeDefined();
    await userEvent.selectOptions(screen.getByLabelText('מע״מ'), 'yes');
    await submit('רישום התשובה');
    expect(await screen.findByText('התשובה של ספק a נרשמה.')).toBeDefined();
    expect(form.isConnected).toBe(false);
    expect(call).toHaveBeenCalledWith(
      'record_approach_answer',
      {
        answer: {
          approach_id: 'a',
          received_on: TODAY,
          note: '',
          answer: 'offer',
          offer_amount: '1200.5',
          offer_includes_vat: true,
        },
      },
      expect.anything(),
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('needs words for "other", a day in range, and keeps the fields after a refusal', async () => {
    const call = vi
      .spyOn(rpc, 'rpc')
      .mockRejectedValueOnce(refusal(400, 'reason:approach_answered', 'rule'));
    show([row('a')]);
    await userEvent.click(await screen.findByRole('button', { name: 'רישום תשובה של ספק a' }));
    await userEvent.selectOptions(screen.getByLabelText('מה הספק ענה'), 'declined');
    await userEvent.selectOptions(screen.getByLabelText('למה'), 'other');
    await submit('רישום התשובה');
    expect(await screen.findByText('כתבו בכמה מילים למה.')).toBeDefined();
    fireEvent.change(screen.getByLabelText('התקבל ב-'), { target: { value: '2026-11-20' } });
    await userEvent.type(screen.getByLabelText(/הערה/u), 'אין צוות');
    await submit('רישום התשובה');
    expect(await screen.findByText(/בין 22.11.2026 ל-24.11.2026/u)).toBeDefined();
    fireEvent.change(screen.getByLabelText('התקבל ב-'), { target: { value: '2026-11-23' } });
    await submit('רישום התשובה');
    expect(await screen.findByText('לפנייה הזו כבר יש תשובה.')).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(/הערה/u).value).toBe('אין צוות');
    expect(call).toHaveBeenCalledWith(
      'record_approach_answer',
      {
        answer: {
          approach_id: 'a',
          received_on: '2026-11-23',
          note: 'אין צוות',
          answer: 'declined',
          decline_reason: 'other',
        },
      },
      expect.anything(),
    );
    await submit('ביטול');
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('extending the deadline', () => {
  it('moves the open deadlines forward with a reason', async () => {
    const call = vi.spyOn(rpc, 'rpc').mockResolvedValue(2);
    show([row('a'), row('b', { channel: 'portal' })]);
    await userEvent.click(await screen.findByRole('button', { name: 'הארכת המועד' }));
    expect(screen.getByLabelText<HTMLInputElement>('מועד חדש').value).toBe('2026-11-30');
    fireEvent.change(screen.getByLabelText('מועד חדש'), { target: { value: '2026-11-29' } });
    await submit('שמירת המועד החדש');
    expect(await screen.findByText(/בחרו מועד בין 30.11.2026/u)).toBeDefined();
    fireEvent.change(screen.getByLabelText('מועד חדש'), { target: { value: '2026-12-03' } });
    await userEvent.type(screen.getByLabelText(/למה מאריכים/u), 'כן');
    await submit('שמירת המועד החדש');
    expect(await screen.findByText('כתבו למה המועד מוארך, לפחות 3 תווים.')).toBeDefined();
    await userEvent.type(screen.getByLabelText(/למה מאריכים/u), ' ביקשו');
    await submit('שמירת המועד החדש');
    expect(await screen.findByText('המועד הוארך ל-03.12.2026 ב-2 פניות.')).toBeDefined();
    expect(call).toHaveBeenCalledWith(
      'extend_approach_deadline',
      { request: 'r1', respond_by: '2026-12-03', reason: 'כן ביקשו' },
      expect.anything(),
    );
  });

  it('offers no extension once every deadline has passed, and cancels', async () => {
    show([row('a', { sealed: false, respond_by: '2026-11-23' })]);
    expect(await screen.findByText('ספק a')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'הארכת המועד' })).toBeNull();
    expect(screen.queryByRole('button', { name: /רישום תשובה/u })).toBeNull();
    cleanup();
    show([row('a')]);
    await userEvent.click(await screen.findByRole('button', { name: 'הארכת המועד' }));
    await submit('ביטול');
    expect(screen.queryByRole('form')).toBeNull();
  });
});

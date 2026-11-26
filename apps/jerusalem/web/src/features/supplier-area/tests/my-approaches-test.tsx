// supplier-approaches-spec-he.md 5: the supplier's panel, the offer and decline dialogs, and
// withdrawing an answer before the deadline.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as rpc from '../../../data/rpc.ts';
import { refusal } from '../../../data/client.ts';
import type { Approach } from '../api/approaches.ts';
import { MyApproaches } from '../components/my-approaches.tsx';

const WAITING: Approach = {
  id: 'ap1',
  subject: 'ייעוץ תנועה',
  unit_name: 'אגף התנועה',
  approached_on: '2026-11-20',
  respond_by: '2026-11-24',
  needed_by: '2027-01-01',
  cancelled: false,
  open: true,
  answer: null,
};
const ANSWERED: Approach = {
  ...WAITING,
  id: 'ap2',
  subject: 'סקר חניה',
  answer: {
    id: 'r1',
    answer: 'offer',
    offer_amount: 100,
    offer_includes_vat: true,
    decline_reason: null,
    note: null,
    source: 'portal',
    withdrawn_at: null,
    created_at: '2026-11-21T09:00:00Z',
  },
};

function show(approaches: Approach[]) {
  const router = createMemoryRouter(
    [
      {
        id: 'area',
        path: '/',
        element: <MyApproaches supplierId="s1" approaches={approaches} today="2026-11-22" />,
        loader: () => null,
      },
    ],
    { hydrationData: { loaderData: { area: null } } },
  );
  render(<RouterProvider router={router} />);
}

function openDialog(name: string): HTMLElement {
  const dialog = screen
    .getAllByRole('dialog', { hidden: true })
    .find((d) => d.textContent.includes(name));
  if (!dialog) throw new Error(`dialog ${name} expected`);
  dialog.setAttribute('open', '');
  return dialog;
}

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('my approaches', () => {
  it('says when there are none', () => {
    show([]);
    expect(screen.getByText(/אין פניות\. כשיחידה בעירייה תפנה אליכם/u)).toBeTruthy();
  });

  it('groups the approaches and marks a near deadline', () => {
    show([WAITING, ANSWERED, { ...WAITING, id: 'ap3', open: false, subject: 'ישן' }]);
    const waiting = within(screen.getByRole('region', { name: 'מחכות לתשובה' }));
    const row = waiting.getByRole('listitem');
    expect(row.dataset.state).toBe('soon');
    expect(row.textContent).toContain('נותרו 2 ימים (עד 24.11.2026)');
    expect(row.textContent).toContain('נדרש עד 01.01.2027');
    const answered = within(screen.getByRole('region', { name: 'עניתם' }));
    expect(answered.getByText('הגשתם הצעה ב-21.11.2026')).toBeTruthy();
    expect(answered.getByRole('button', { name: 'ביטול ההצעה' })).toBeTruthy();
    const closed = within(screen.getByRole('region', { name: 'נסגרו' }));
    expect(closed.getByText('המועד עבר בלי תשובה')).toBeTruthy();
    expect(closed.queryByRole('button')).toBeNull();
  });

  it('checks the offer, then uploads the file and sends it', async () => {
    vi.spyOn(rpc, 'freshToken').mockResolvedValue('t');
    const upload = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const call = vi
      .spyOn(rpc, 'rpc')
      .mockImplementation((_n, _a, schema) => Promise.resolve(schema.parse(ANSWERED.answer)));
    show([WAITING]);
    const dialog = within(openDialog('הגשת הצעה: ייעוץ תנועה'));
    const send = dialog.getByRole('button', { name: 'שליחת ההצעה' });
    await userEvent.type(dialog.getByLabelText(/סכום ההצעה/u), '1.234');
    await userEvent.click(send);
    expect(dialog.getByText(/סכום חיובי/u)).toBeTruthy();
    await userEvent.clear(dialog.getByLabelText(/סכום ההצעה/u));
    await userEvent.type(dialog.getByLabelText(/סכום ההצעה/u), '120,000');
    await userEvent.click(send);
    expect(dialog.getByText('בחרו אם הסכום כולל מע״מ.')).toBeTruthy();
    await userEvent.selectOptions(dialog.getByLabelText(/מע״מ/u), 'yes');
    expect(dialog.getByText(/הצעה של 120,000 ₪ כולל מע״מ/u)).toBeTruthy();
    await userEvent.click(send);
    expect(dialog.getByText('יש לצרף קובץ.')).toBeTruthy();
    const pdf = new File(['%PDF'], 'offer.pdf', { type: 'application/pdf' });
    await userEvent.upload(dialog.getByLabelText(/קובץ ההצעה/u), pdf);
    await userEvent.click(send);
    await vi.waitFor(() => {
      expect(call).toHaveBeenCalled();
    });
    expect(upload.mock.calls[0]?.[0]).toMatch(/\/supplier-documents\/s1\/offers\/ap1\/.+\.pdf$/u);
    expect(call).toHaveBeenCalledWith(
      'portal_answer_approach',
      {
        answer: expect.objectContaining({
          approach_id: 'ap1',
          answer: 'offer',
          offer_amount: '120000',
          offer_includes_vat: true,
        }) as unknown,
      },
      expect.anything(),
    );
  });

  it('asks why on "other", and shows a refusal', async () => {
    const call = vi
      .spyOn(rpc, 'rpc')
      .mockRejectedValue(refusal(400, 'reason:approach_closed', 'rule'));
    show([WAITING]);
    const dialog = within(openDialog('לא מעוניינים: ייעוץ תנועה'));
    await userEvent.selectOptions(dialog.getByLabelText(/למה/u), 'other');
    await userEvent.click(dialog.getByRole('button', { name: 'שליחה' }));
    expect(dialog.getByText('כתבו בכמה מילים למה.')).toBeTruthy();
    expect(call).not.toHaveBeenCalled();
    await userEvent.type(dialog.getByLabelText(/פירוט/u), 'אין צוות פנוי');
    await userEvent.click(dialog.getByRole('button', { name: 'שליחה' }));
    expect(await dialog.findByText(/המועד לתשובה עבר/u)).toBeTruthy();
    expect(call).toHaveBeenCalledWith(
      'portal_answer_approach',
      {
        answer: {
          approach_id: 'ap1',
          answer: 'declined',
          decline_reason: 'other',
          note: 'אין צוות פנוי',
        },
      },
      expect.anything(),
    );
  });

  it('withdraws an answer before the deadline', async () => {
    const call = vi
      .spyOn(rpc, 'rpc')
      .mockRejectedValueOnce(refusal(400, 'reason:approach_closed', 'rule'))
      .mockResolvedValueOnce(null);
    const declined = ANSWERED.answer ? { ...ANSWERED.answer, answer: 'declined' as const } : null;
    show([{ ...ANSWERED, answer: declined }]);
    const button = screen.getByRole('button', { name: 'ביטול התשובה' });
    await userEvent.click(button);
    expect(await screen.findByText(/המועד לתשובה עבר/u)).toBeTruthy();
    await userEvent.click(button);
    expect(call).toHaveBeenLastCalledWith(
      'portal_withdraw_answer',
      { response_id: 'r1' },
      expect.anything(),
    );
  });
});

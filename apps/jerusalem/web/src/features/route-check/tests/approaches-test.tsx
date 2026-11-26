// supplier-approaches-spec-he.md 6.1 and 6.2: the deadline range, the answer in words, and the
// staff table that shows an offer's amount only after the deadline.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as files from '../../../data/files.ts';
import * as rpc from '../../../data/rpc.ts';
import * as api from '../api/approaches.ts';
import type { RequestApproach } from '../api/approaches.ts';
import { RequestApproaches, ordered } from '../components/request-approaches.tsx';
import { addedText } from '../components/approach-form.tsx';
import { answerText, comparable, deadlineRange, opensOn } from '../model/approaches.ts';

const base = {
  channel: 'portal' as const,
  approached_on: '2026-11-22',
  respond_by: '2026-11-29',
  sealed: false,
};
const answered = { id: 'x', received_on: null, created_at: '2026-11-23T10:00:00Z' };
const offer = (amount: number | null, vat: boolean | null, file: string | null = null) => ({
  ...answered,
  answer: 'offer' as const,
  decline_reason: null,
  source: 'portal' as const,
  offer_amount: amount,
  offer_includes_vat: vat,
  file_path: file,
});
const row = (id: string, more: Partial<RequestApproach>): RequestApproach => ({
  ...base,
  id,
  supplier_id: id,
  supplier_name: `ספק ${id}`,
  answer: null,
  ...more,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('approach model', () => {
  it('offers a week ahead, from tomorrow up to 90 days', () => {
    expect(deadlineRange('2026-11-22')).toEqual({
      initial: '2026-11-29',
      min: '2026-11-23',
      max: '2027-02-20',
    });
    expect(opensOn('2026-11-30')).toBe('01.12.2026');
    expect(addedText(2, 3, '2026-11-29')).toBe(
      'נרשמו 2 פניות, עם מועד לתשובה 29.11.2026. 1 כבר קיבלו פנייה לבקשה הזו.',
    );
  });

  it('puts each answer in words and compares offers with VAT', () => {
    expect(answerText(null)).toBe('ממתין לתשובה');
    expect(answerText(offer(null, null))).toBe('הגיש הצעה');
    expect(answerText(offer(1000, false))).toMatch(/^הצעה: .*1,000.* לא כולל מע״מ$/u);
    const declined = {
      ...answered,
      answer: 'declined' as const,
      decline_reason: 'other',
      source: 'staff' as const,
      note: 'בחופש',
    };
    expect(answerText(declined)).toBe('לא מעוניין: אחר, בחופש (נרשם בידי העירייה)');
    expect(answerText({ ...declined, note: null, source: 'portal' })).toBe('לא מעוניין: אחר');
    expect(answerText({ ...declined, decline_reason: null })).toMatch(/^לא מעוניין: אחר,/u);
    expect(answerText({ ...offer(5, true), source: 'staff' })).toMatch(
      /כולל מע״מ \(נרשם בידי העירייה\)$/u,
    );
    expect(addedText(3, 3, '2026-11-29')).toBe('נרשמו 3 פניות, עם מועד לתשובה 29.11.2026.');
    expect(comparable(null)).toBeNull();
    expect(comparable(offer(1000, false))).toBe(1180);
    expect(comparable(offer(1000, true))).toBe(1000);
    expect(comparable(declined)).toBeNull();
    const list = [
      row('a', {}),
      row('b', { answer: offer(2000, true) }),
      row('c', { answer: offer(1000, false) }),
    ];
    expect(ordered(list).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('request approaches', () => {
  it('asks the database for the request and reads an unknown channel as other', async () => {
    const call = vi
      .spyOn(rpc, 'rpc')
      .mockImplementation((_name, _args, schema) =>
        Promise.resolve(schema.parse([{ ...row('a', {}), channel: 'fax' }])),
      );
    const [first] = await api.loadRequestApproaches('r1');
    expect(first?.channel).toBe('other');
    expect(call).toHaveBeenCalledWith(
      'request_approaches',
      { request_id: 'r1' },
      expect.anything(),
    );
  });

  it('says when sealed offers open', async () => {
    vi.spyOn(api, 'loadRequestApproaches').mockResolvedValue([
      row('a', { sealed: true, answer: offer(null, null) }),
    ]);
    render(<RequestApproaches requestId="r1" today="2026-11-24" status="submitted" />);
    expect(await screen.findByText('ההצעות ייפתחו ב-30.11.2026 ב-00:00.')).toBeDefined();
    expect(screen.getByRole('table').textContent).toContain('הגיש הצעה');
    expect(screen.queryByText(/לצורך השוואה/u)).toBeNull();
  });

  it('shows opened offers cheapest first and opens the file', async () => {
    vi.spyOn(api, 'loadRequestApproaches').mockResolvedValue([
      row('a', { answer: offer(2000, true) }),
      row('b', { answer: offer(1000, false, 's/offers/b/o.pdf'), respond_by: null }),
    ]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const sign = vi.spyOn(files, 'signedFileUrl').mockResolvedValue('https://signed');
    render(<RequestApproaches requestId="r1" today="2026-11-24" status="submitted" />);
    const [, first] = await screen.findAllByRole('row');
    expect(first?.textContent).toContain('ספק b');
    expect(first?.textContent).toContain('בלי מועד');
    expect(screen.getByText(/לצורך השוואה בלבד/u)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'פתיחת קובץ ההצעה של ספק b' }));
    expect(sign).toHaveBeenCalledWith('s/offers/b/o.pdf');
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledWith('https://signed', '_blank', 'noopener');
    });
  });

  it('says when a file cannot be opened', async () => {
    vi.spyOn(api, 'loadRequestApproaches').mockResolvedValue([
      row('a', { answer: offer(10, true, 'p') }),
    ]);
    vi.spyOn(files, 'signedFileUrl').mockRejectedValue(new Error('x'));
    render(<RequestApproaches requestId="r1" today="2026-11-24" status="submitted" />);
    await userEvent.click(await screen.findByRole('button', { name: /פתיחת קובץ/u }));
    expect(await screen.findByText(/תקלה במערכת/u)).toBeDefined();
  });

  it('shows an empty list and a failure', async () => {
    const load = vi.spyOn(api, 'loadRequestApproaches').mockResolvedValueOnce([]);
    render(<RequestApproaches requestId="r1" today="2026-11-24" status="submitted" />);
    expect(await screen.findByText('עוד לא נרשמו פניות')).toBeDefined();
    cleanup();
    load.mockRejectedValueOnce(new Error('x'));
    render(<RequestApproaches requestId="r2" today="2026-11-24" status="submitted" />);
    expect(await screen.findByRole('alert')).toBeDefined();
  });
});

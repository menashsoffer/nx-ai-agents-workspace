// Kind suggestions on the identifiers screen (supplier-edit-checks-spec section 3).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import * as rpc from '../../../data/rpc.ts';
import * as screenData from '../../../data/screen-data.ts';
import { DataError } from '../../../data/client.ts';
import { KindSuggestions, type KindRow } from '../components/kind-suggestions.tsx';
import { reasonText } from '../model/kinds.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row: KindRow = {
  supplier: 'אור לציון',
  suggestion: {
    id: 'k1',
    supplier_id: 's1',
    suggested_kind: 'nonprofit',
    strength: 'strong',
    reasons: [{ source: 'registry', scheme: 'nonprofit', value: '580000001', kind: 'nonprofit' }],
  },
};

describe('kind suggestions', () => {
  it('explains each reason in a sentence', () => {
    expect(reasonText({ source: 'registry', scheme: 'company', value: '5', kind: 'company' })).toBe(
      'במרשם, סוג התאגיד של מספר חברה 5 הוא חברה.',
    );
    expect(reasonText({ source: 'identifier', value: '7', kind: 'sole_trader' })).toMatch(
      /^מספר 7, שעדיין ממתין לבדיקה, מתאים לעוסק\.$/u,
    );
    expect(reasonText({ source: 'name', kind: 'company' })).toBe('שם הספק מרמז על חברה.');
  });

  it('accepts a suggestion and says what happened', async () => {
    const call = vi.spyOn(rpc, 'rpc').mockResolvedValue('pending');
    vi.spyOn(screenData, 'refreshScreen').mockResolvedValue(undefined);
    render(<KindSuggestions rows={[row]} />);
    expect(screen.getByRole('heading', { name: 'הצעות סוג ישות (1)' })).toBeDefined();
    await userEvent.click(screen.getByText('אור לציון'));
    expect(screen.getByText(/סוג התאגיד של מספר עמותה 580000001 הוא עמותה/u)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'קבלת הסוג' }));
    expect(await screen.findByText('השינוי נשלח לאישור של מנהל מערכת.')).toBeDefined();
    expect(call).toHaveBeenCalledWith(
      'decide_kind_suggestion',
      { target: 'k1', accept: true },
      expect.anything(),
    );
  });

  it('shows "שומר…" only on the pressed button while it saves', async () => {
    let finish: (value: string) => void = () => undefined;
    vi.spyOn(rpc, 'rpc').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.spyOn(screenData, 'refreshScreen').mockResolvedValue(undefined);
    render(<KindSuggestions rows={[row]} />);
    await userEvent.click(screen.getByText('אור לציון'));
    await userEvent.click(screen.getByRole('button', { name: 'דחיית ההצעה' }));
    expect(screen.getAllByRole('button', { name: 'שומר…' })).toHaveLength(1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'קבלת הסוג' }).disabled).toBe(
      true,
    );
    finish('rejected');
  });

  it('treats a suggestion someone else decided as done, and shows other errors', async () => {
    vi.spyOn(rpc, 'rpc').mockRejectedValueOnce(new DataError(404));
    vi.spyOn(screenData, 'refreshScreen').mockRejectedValue(new Error('offline'));
    render(<KindSuggestions rows={[row]} />);
    await userEvent.click(screen.getByText('אור לציון'));
    await userEvent.click(screen.getByRole('button', { name: 'דחיית ההצעה' }));
    expect(await screen.findByText(/ההצעה כבר טופלה. יש לרענן/u)).toBeDefined();
  });

  it('runs the suggestions for an admin and reports the counts', async () => {
    vi.spyOn(rpc, 'rpc').mockResolvedValue({ created: 299, unknown: 1004 });
    vi.spyOn(screenData, 'refreshScreen').mockResolvedValue(undefined);
    render(<KindSuggestions rows={[]} />);
    expect(screen.getByText('אין הצעות סוג ממתינות')).toBeDefined();
    await userEvent.click(
      screen.getByRole('button', { name: 'הצעת סוג לספקים שהסוג שלהם לא ידוע' }),
    );
    expect(
      await screen.findByText('נוספו 299 הצעות. 1004 ספקים עדיין בסוג לא ידוע.'),
    ).toBeDefined();
  });

  it('shows a refusal when the run fails', async () => {
    vi.spyOn(rpc, 'rpc').mockRejectedValue(new DataError(403));
    render(<KindSuggestions rows={[]} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'הצעת סוג לספקים שהסוג שלהם לא ידוע' }),
    );
    expect(await screen.findByRole('alert')).toBeDefined();
  });
});

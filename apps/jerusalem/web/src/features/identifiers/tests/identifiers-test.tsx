import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { IdentifiersPage } from '../identifiers-page.tsx';
import * as api from '../api/candidates.ts';
import { DataError } from '../../../data/client.ts';
function data(): Awaited<ReturnType<typeof api.loadCandidates>> {
  return {
    candidates: [
      {
        id: 'candidate',
        supplier_id: 'supplier',
        scheme: 'company',
        value: '512345678',
        source: 'companies_registrar',
        registrar_name: 'יועצי העיר',
        registrar_status: 'פעילה',
        searched_name: 'יועצי העיר',
        found_at: '2026-11-16',
      },
    ],
    kinds: [],
    suppliers: [{ id: 'supplier', display_name: 'יועצי העיר' }],
  };
}
function page(value = data()) {
  const router = createMemoryRouter([
    { path: '/', Component: IdentifiersPage, loader: () => value },
  ]);
  render(<RouterProvider router={router} />);
  return value;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('manual identifier candidates', () => {
  it('shows the source and comparison without making an automatic decision', async () => {
    const decide = vi.spyOn(api, 'decideCandidate');
    page();
    expect(await screen.findByRole('heading', { name: 'מועמדי מזהה ספק (1)' })).toBeDefined();
    await userEvent.click(screen.getByText('שמות זהים'));
    expect(screen.getByText(/זהו רמז בלבד/)).toBeDefined();
    expect(within(screen.getByRole('group')).getByText('רשם החברות')).toBeDefined();
    expect(screen.getByText(/קבלה שולחת אותו לאימות של אדם נוסף/)).toBeDefined();
    expect(decide).not.toHaveBeenCalled();
  });
  it('marks the words a registry name adds, and filters by source and name', async () => {
    const value = data();
    const first = value.candidates[0];
    if (!first) throw new Error('fixture');
    value.candidates = [
      {
        ...first,
        id: 'b',
        supplier_id: 'other',
        registrar_name: 'בונים בע"מ',
        source: 'guidestar',
      },
      first,
    ];
    value.suppliers.push({ id: 'other', display_name: 'אחרים' });
    page(value);
    const rows = await screen.findAllByRole('group');
    expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual([
      'יועצי העיר',
      'אחרים',
    ]);
    expect(screen.getByText('בונים').tagName).toBe('MARK');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'מקור' }), 'guidestar');
    expect(await screen.findByText('מוצגים 1 מתוך 1')).toBeDefined();
    await userEvent.type(screen.getByRole('searchbox'), 'לא קיים');
    expect(
      await screen.findByRole('heading', { name: 'אין מועמדים שמתאימים לסינון' }),
    ).toBeDefined();
  });
  it('shows 25 at a time', async () => {
    const value = data();
    const first = value.candidates[0];
    if (!first) throw new Error('fixture');
    value.candidates = Array.from({ length: 30 }, (_, i) => ({ ...first, id: `c${String(i)}` }));
    page(value);
    expect(await screen.findByText('מוצגים 25 מתוך 30')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'הצגת 25 נוספים' }));
    expect(await screen.findByText('מוצגים 30 מתוך 30')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'הצגת 25 נוספים' })).toBeNull();
  });
  it('keeps the candidate until manual acceptance succeeds', async () => {
    const value = page();
    let finish: () => void = () => undefined;
    const decide = vi.spyOn(api, 'decideCandidate').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            value.candidates = [];
            resolve();
          };
        }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'קבלה לבדיקה נוספת' }));
    expect(screen.getByText('מצב במרשם')).toBeDefined();
    // Only the pressed button saves; the other keeps its label, off (25.11.2026).
    expect(screen.getAllByRole('button', { name: 'שומר…' })).toHaveLength(1);
    const other = screen.getByRole<HTMLButtonElement>('button', { name: 'דחיית המועמד' });
    expect(other.disabled).toBe(true);
    finish();
    expect(await screen.findByRole('heading', { name: 'אין מועמדים ממתינים' })).toBeDefined();
    expect(decide).toHaveBeenCalledWith('candidate', true);
  });
  it('dismisses only by an explicit decision', async () => {
    const value = page();
    const decide = vi.spyOn(api, 'decideCandidate').mockImplementation(() => {
      value.candidates = [];
      return Promise.resolve();
    });
    await userEvent.click(await screen.findByRole('button', { name: 'דחיית המועמד' }));
    expect(await screen.findByRole('heading', { name: 'אין מועמדים ממתינים' })).toBeDefined();
    expect(decide).toHaveBeenCalledWith('candidate', false);
  });
  it('keeps evidence visible on server rejection', async () => {
    page();
    vi.spyOn(api, 'decideCandidate').mockRejectedValue(new DataError(403));
    await userEvent.click(await screen.findByRole('button', { name: 'דחיית המועמד' }));
    expect((await screen.findByRole('alert')).textContent).toContain('אין לך הרשאה');
    expect(screen.getByText('מצב במרשם')).toBeDefined();
  });
  it('lists kind suggestions under the candidates, by supplier name', async () => {
    const value = data();
    value.candidates = [];
    value.kinds = [
      {
        id: 'kind',
        supplier_id: 'supplier',
        suggested_kind: 'company',
        strength: 'medium',
        reasons: [{ source: 'name', kind: 'company' }],
      },
    ];
    page(value);
    expect(await screen.findByRole('heading', { name: 'הצעות סוג ישות (1)' })).toBeDefined();
    expect(screen.getByText('יועצי העיר')).toBeDefined();
  });
});

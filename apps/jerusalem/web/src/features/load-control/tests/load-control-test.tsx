import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { LoadControlPage } from '../load-control-page.tsx';
import type { LoadControl } from '../api/control.ts';

const registry = { status: 'active', memberships: 52, needs_review: 0, verified: 52 };
const value = (): LoadControl => ({
  jobs: [
    { job: 'cbs-index', status: 'failed', started_at: '2026-11-16T05:00:00Z', finished_at: null },
    { job: 'cbs-index', status: 'ok', started_at: '2026-11-15T05:00:00Z', finished_at: null },
  ],
  batches: [],
  registries: [
    { ...registry, name: 'מאגר הנדסה' },
    { ...registry, name: 'מאגר אולמות 2024', needs_review: 52, verified: 0 },
    { ...registry, name: 'מאגר ישן', status: 'closed' },
  ],
  candidates: { companies_registrar: 3, guidestar: 2 },
  identifiers_pending: 7,
  same_names: 2,
  venues: 98,
});
afterEach(cleanup);
function page(data = value()) {
  const router = createMemoryRouter(
    [{ id: 'control', path: '/', Component: LoadControlPage, loader: () => data }],
    { hydrationData: { loaderData: { control: data } } },
  );
  render(<RouterProvider router={router} />);
}

describe('load control page', () => {
  it('starts with four numbers, linking the one that has a screen', () => {
    page();
    const stats = within(screen.getByRole('list', { name: 'סיכום' })).getAllByRole('listitem');
    expect(stats).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'מועמדים ממתינים' }).getAttribute('href')).toBe(
      '/identifiers',
    );
    expect(screen.getByText('3 מרשם החברות, 2 מגיידסטאר')).toBeDefined();
  });
  it('sorts registries by rows in review and filters them by name', async () => {
    page();
    const table = screen.getByRole('table', { name: /מאגרים \(3\)/ });
    const names = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent);
    expect(names[0]).toBe('מאגר אולמות 2024');
    expect(within(table).getByText('סגור')).toBeDefined();
    await userEvent.type(screen.getByRole('searchbox', { name: 'חיפוש מאגר' }), 'הנדסה');
    expect(await screen.findByRole('table', { name: /מאגרים \(1\)/ })).toBeDefined();
    await userEvent.type(screen.getByRole('searchbox', { name: 'חיפוש מאגר' }), 'xyz');
    expect(await screen.findByText('אין מאגר שמתאים לחיפוש.')).toBeDefined();
  });
  it('keeps runs and file loads under closed technical details, with failures counted', () => {
    page();
    const details = screen.getByText('פרטים טכניים (הרצה אחת נכשלה)').closest('details');
    expect(details?.open).toBe(false);
    expect(within(details as HTMLElement).getByText('נכשל')).toBeDefined();
    expect(within(details as HTMLElement).getByText('אין טעינות קבצים רשומות.')).toBeDefined();
  });
});

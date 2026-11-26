import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Access } from '../../../data/access.ts';
import * as rpc from '../../../data/rpc.ts';
import { HomePage, loader } from '../home-page.tsx';
import type { HomeOverview } from '../model/overview.ts';

const ACCESS: Access = {
  state: 'active',
  member: true,
  admin: true,
  editor: false,
  manager: false,
  grants: [],
};
const HOME: HomeOverview = {
  active_suppliers: 1276,
  registries: 49,
  memberships: 2798,
  memberships_verified: 28,
  suppliers_identified: 473,
  my_open_requests: 2,
  lapsed: [{ registry_id: 'r1', name: 'פיתוח המשאב האנושי', count: 66, ended_on: '2026-11-07' }],
  kind_suggestions_pending: 297,
  registries_without_unit: 23,
};

function signIn(access: Access, home: HomeOverview | Error) {
  vi.spyOn(rpc, 'getAdminSession').mockReturnValue({ token: 't', exp: 1, refresh: 'r' });
  vi.spyOn(rpc, 'identity').mockResolvedValue({ userId: 'u', access });
  vi.spyOn(rpc, 'rpc').mockImplementation((name) => {
    if (name === 'home_overview')
      return home instanceof Error ? Promise.reject(home) : Promise.resolve(home);
    return Promise.resolve({ identifiers_pending: 377 });
  });
}

function open() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <HomePage />, loader },
      { path: '/catalog', element: <h1>איתור ספקים</h1> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('home screen', () => {
  it('shows what waits, the quick actions and the registry numbers', async () => {
    signIn(ACCESS, HOME);
    open();
    expect(await screen.findByRole('heading', { level: 1, name: /טוב/ })).toBeDefined();
    expect(screen.getByText('יש 4 נושאים פתוחים, אחד מהם דחוף.')).toBeDefined();
    expect(screen.getByRole('region', { name: /^דחוף/ }).textContent).toContain('פיתוח המשאב');
    expect(screen.getByRole('region', { name: /^מחכה לאישור שלך/ }).textContent).toContain('297');
    expect(screen.getByRole('region', { name: /^להשלים/ }).textContent).toContain('23');
    const waiting = screen.getByRole('region', { name: 'מחכה לך' });
    expect(waiting.textContent).toContain('66 ספקים במאגר "פיתוח המשאב האנושי"');
    expect(waiting.textContent).toContain('377 מועמדים ממתינים');
    expect(screen.getByRole('link', { name: 'קליטת ספקים מאקסל' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'מצב המאגרים' }).textContent).toContain('1,276');
  });

  it('opens the catalog with the search typed on the home screen', async () => {
    signIn(ACCESS, HOME);
    const router = open();
    const box = await screen.findByRole('searchbox', { name: 'חיפוש ספק' });
    fireEvent.change(box, { target: { value: 'הדרכה' } });
    fireEvent.click(screen.getByRole('button', { name: 'חיפוש' }));
    await screen.findByRole('heading', { name: 'איתור ספקים' });
    expect(router.state.location.state).toEqual({ query: 'הדרכה' });
  });

  it('opens a lapsed registry from its lane, already filtered', async () => {
    signIn(ACCESS, HOME);
    const router = open();
    fireEvent.click(await screen.findByRole('button', { name: /^לרשימה: 66 ספקים/ }));
    await screen.findByRole('heading', { name: 'איתור ספקים' });
    expect(router.state.location.state).toEqual({ registry: 'r1', validity: 'expired' });
  });

  it('still works when the numbers cannot be read, and hides admin actions', async () => {
    signIn({ ...ACCESS, admin: false, grants: [{ role: 'viewer', unitId: 'x' }] }, new Error('x'));
    open();
    expect(await screen.findByText('מצב המאגרים לא נטען.')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'קליטת ספקים מאקסל' })).toBeNull();
    expect(screen.getByText('אין כרגע עבודה שמחכה לך.')).toBeDefined();
    expect(screen.getByText('הכול טופל. יום שקט לפניך.')).toBeDefined();
  });

  it('sends someone who is not active staff to the catalog', async () => {
    signIn({ ...ACCESS, state: 'pending', member: false, admin: false }, HOME);
    const router = open();
    await screen.findByRole('heading', { name: 'איתור ספקים' });
    expect(router.state.location.pathname).toBe('/catalog');
  });
});

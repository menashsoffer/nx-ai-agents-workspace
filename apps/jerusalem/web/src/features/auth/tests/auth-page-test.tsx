import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthPage, EXPIRED_NOTICE, loader } from '../auth-page.tsx';
import type { Access, Role } from '../../../data/access.ts';
import * as rpc from '../../../data/rpc.ts';
import { setAdminSession } from '../../../data/rpc.ts';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setAdminSession(null);
});
function page(access: Access | null) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        Component: AuthPage,
        loader: () => ({
          who: access ? { userId: 'user', access } : null,
          account: null,
          expired: false,
        }),
      },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}
describe('admin identity screen', () => {
  it('offers labelled native sign-in controls when signed out', async () => {
    page(null);
    expect(await screen.findByRole('heading', { name: 'כניסה והרשאות', level: 1 })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'דוא״ל' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'שליחת קישור כניסה' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'כניסה באמצעות Google' })).toBeDefined();
  });
  for (const [state, message] of [
    ['blocked', 'חסומה'],
    ['rejected', 'נדחתה'],
  ] as const) {
    it(`explains ${state} without presenting a login form`, async () => {
      page({ state, member: false, admin: false, editor: false, manager: false, grants: [] });
      expect((await screen.findByRole('status')).textContent).toContain(message);
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  }
  it('tells a pending user that the request waits, without a login form', async () => {
    page({
      state: 'pending',
      member: false,
      admin: false,
      editor: false,
      manager: false,
      grants: [],
    });
    expect(await screen.findByText('הבקשה נשלחה וממתינה לאישור מנהל.')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
  for (const role of ['viewer', 'editor', 'unit_manager', 'admin', 'auditor'] satisfies Role[]) {
    it(`shows an active ${role} without trusting JWT claims`, async () => {
      page({
        state: 'active',
        member: true,
        admin: role === 'admin',
        editor: false,
        manager: false,
        grants: [{ role, unitId: null }],
      });
      expect(await screen.findByRole('button', { name: 'יציאה מהמערכת' })).toBeDefined();
      expect(screen.getByRole('status').textContent).toContain('פעילה');
    });
  }
  it('announces a callback error', async () => {
    setAdminSession(null, 'תוקף ניסיון ההתחברות פג.');
    page(null);
    expect((await screen.findByRole('alert')).textContent).toContain('פג');
  });
});
describe('arriving at sign-in from another screen', () => {
  it('explains that the sign-in ended and offers the sign-in controls', async () => {
    const router = createMemoryRouter([{ path: '/auth', Component: AuthPage, loader }], {
      initialEntries: ['/auth?next=%2Fusers&reason=expired'],
    });
    render(<RouterProvider router={router} />);
    expect((await screen.findByRole('alert')).textContent).toBe(EXPIRED_NOTICE);
    expect(screen.getByRole('button', { name: 'כניסה באמצעות Google' })).toBeDefined();
  });

  it('sends an active user straight back to the screen they came from', async () => {
    vi.spyOn(rpc, 'identity').mockResolvedValue({
      userId: 'user',
      access: {
        state: 'active',
        member: true,
        admin: true,
        editor: false,
        manager: false,
        grants: [],
      },
    });
    setAdminSession({ token: 't', exp: Date.now() + 3_600_000, refresh: 'r' });
    const router = createMemoryRouter(
      [
        { path: '/auth', Component: AuthPage, loader },
        { path: '/users', element: <h1>משתמשים</h1> },
      ],
      { initialEntries: ['/auth?next=%2Fusers'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'משתמשים' })).toBeDefined();
  });
});

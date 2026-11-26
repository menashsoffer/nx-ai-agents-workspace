// The frame by role (screens-spec-he.md 11 and 12): tabs, account menu, admin home, errors.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import * as catalog from '../../data/react-catalog.ts';
import * as site from '../../data/site.ts';
import { setAdminSession } from '../../data/rpc.ts';
import type { Access, Role } from '../../data/access.ts';
import type { CatalogState } from '../../data/snapshot.ts';
import { DataError } from '../../data/client.ts';
import { SiteHeader } from '../site-header.tsx';
import { HomePage } from '../home-page.tsx';
import { NotFoundPage } from '../not-found-page.tsx';
import { ScreenError } from '../screen-error.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setAdminSession(null);
});

function signedIn(roles: Role[]): Access {
  const access: Access = {
    state: 'active',
    member: true,
    admin: roles.includes('admin'),
    editor: roles.includes('editor'),
    manager: roles.includes('unit_manager'),
    grants: roles.map((role) => ({ role, unitId: null })),
  };
  vi.spyOn(catalog, 'useCatalogSnapshot').mockReturnValue({ access } as unknown as CatalogState);
  vi.spyOn(site, 'getAccess').mockReturnValue(access);
  const claims = Buffer.from(JSON.stringify({ email: 'dana@example.test' })).toString('base64url');
  setAdminSession({ token: `x.${claims}.x`, exp: Date.now() + 3_600_000, refresh: 'r' });
  return access;
}

function at(path: string, element: React.ReactNode, loader: () => unknown = () => null) {
  const router = createMemoryRouter(
    [
      { path, element, loader, errorElement: <ScreenError /> },
      { path: '/catalog', element: <h1>איתור ספקים</h1> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('top bar', () => {
  it('hides the admin tab from a viewer and links the circle to the personal area', async () => {
    signedIn(['viewer']);
    at('/x', <SiteHeader />);
    const nav = await screen.findByRole('navigation', { name: 'ניווט ראשי' });
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual([
      'בית',
      'איתור ספקים',
      'בקשות',
    ]);
    const personal = screen.getByRole('link', { name: 'האזור האישי' });
    expect(personal.textContent).toBe('D');
    expect(personal.getAttribute('href')).toBe('/auth');
  });

  it('shows the admin tab to an editor', async () => {
    signedIn(['editor']);
    at('/x', <SiteHeader />);
    expect(await screen.findByRole('link', { name: 'ניהול' })).toBeDefined();
  });

  it('offers sign-in when nobody is signed in', async () => {
    at('/x', <SiteHeader />);
    expect(await screen.findByRole('link', { name: 'כניסה למערכת' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'ניהול' })).toBeNull();
  });
});

describe('admin home', () => {
  it('shows an auditor only load control, under tools', async () => {
    signedIn(['auditor']);
    at('/admin', <HomePage />);
    expect(await screen.findByRole('link', { name: 'בקרת טעינה' })).toBeDefined();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'כלים' })).toBeDefined();
    expect(screen.queryByRole('region', { name: 'ממתין לטיפול' })).toBeNull();
  });

  it('shows the waiting count on each work card, and "none waiting" at zero', async () => {
    signedIn(['admin']);
    const counts = { users_pending: 2, identifiers_pending: 1, categories_pending: 0 };
    at('/admin', <HomePage />, () => ({ counts }));
    expect(await screen.findByText('2 בקשות ממתינות')).toBeDefined();
    expect(screen.getByText('מועמד ממתין אחד')).toBeDefined();
    expect(screen.getByText('אין ממתינים')).toBeDefined();
    expect(screen.queryByText(/ממתינ(ה|ות) אחת$|לבדיקה$/, { selector: 'span' })).toBeNull();
  });

  it('explains when there is no admin screen for this user', async () => {
    signedIn(['viewer']);
    at('/admin', <HomePage />);
    expect(await screen.findByText('אין לך מסכי ניהול.')).toBeDefined();
  });
});

describe('errors', () => {
  it('says who a forbidden screen is for and what the user role is', async () => {
    signedIn(['viewer']);
    const router = createMemoryRouter(
      [
        {
          path: '/users',
          loader: () => {
            throw new DataError(403);
          },
          errorElement: <ScreenError />,
        },
      ],
      { initialEntries: ['/users'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'אין לך הרשאה למסך הזה' })).toBeDefined();
    expect(
      screen.getByText('המסך מיועד למנהל יחידה או מנהל מערכת. התפקיד שלך: צופה.'),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'לאיתור ספקים' })).toBeDefined();
  });

  it('offers the catalog and a way back from an address that does not exist', async () => {
    at('/nowhere', <NotFoundPage />);
    expect(await screen.findByText('הכתובת לא קיימת באתר. אולי הקישור ישן.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'לאיתור ספקים' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'חזרה' })).toBeDefined();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as catalog from '../../data/react-catalog.ts';
import * as rpc from '../../data/rpc.ts';
import type { CatalogState } from '../../data/snapshot.ts';
import type { Access } from '../../data/access.ts';

import { Layout } from '../layout.tsx';
import { RouteError } from '../route-error.tsx';
import { routes } from '../routes.tsx';

function renderAt(path: string, table = routes) {
  render(<RouterProvider router={createMemoryRouter(table, { initialEntries: [path] })} />);
}

const ACCESS: Access = {
  state: 'active',
  member: true,
  admin: true,
  editor: false,
  manager: false,
  grants: [],
};
const ADMIN = { access: ACCESS } as unknown as CatalogState;

beforeEach(() => {
  vi.spyOn(catalog, 'useCatalogSnapshot').mockReturnValue(ADMIN);
  vi.spyOn(rpc, 'identity').mockResolvedValue({ userId: 'u', access: ACCESS });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('admin routes', () => {
  it('sends a visitor without a session from the site root to the catalog', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/catalog');
    });
  });

  it('shows the admin home with its title', async () => {
    renderAt('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'ניהול' })).toBeDefined();
    await waitFor(() => {
      expect(document.title).toBe('ניהול | איתור ספקים');
    });
  });

  it('marks the admin tab as the current page on admin screens', async () => {
    renderAt('/admin');
    await screen.findByRole('heading', { level: 1, name: 'ניהול' });
    const nav = screen.getByRole('navigation', { name: 'ניווט ראשי' });
    const current = nav.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('ניהול');
  });

  it('focuses the current heading without changing the hash route when skipping navigation', async () => {
    renderAt('/admin');
    const heading = await screen.findByRole('heading', { level: 1, name: 'ניהול' });
    fireEvent.click(screen.getByRole('link', { name: 'דילוג לתוכן' }));
    expect(document.activeElement).toBe(heading);
  });

  it('shows a not-found screen for an unknown path, inside the shared frame', async () => {
    renderAt('/no-such-screen');
    expect(await screen.findByRole('heading', { level: 1, name: 'הדף לא נמצא' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'דילוג לתוכן' })).toBeDefined();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('replaces a screen that throws with an error notice', async () => {
    const Broken = () => {
      throw new Error('broken');
    };
    renderAt('/', [
      {
        path: '/',
        element: <Layout />,
        errorElement: <RouteError />,
        children: [{ index: true, Component: Broken }],
      },
    ]);
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'משהו השתבש' })).toBeDefined();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import * as reactCatalog from '../../../data/react-catalog.ts';
import * as rpc from '../../../data/rpc.ts';
import { replaceShortlist, toggleShortlist } from '../../../lib/shortlist.ts';
import { access } from '../../../../tests/catalog-fixture.ts';
import { CatalogPage, loader } from '../catalog-page.tsx';
import { state } from './fixture.ts';

const A = '10000000-0000-4000-8000-000000000001';

function page(verified: Promise<rpc.Identity>) {
  const data = { verified, today: '2026-11-16' };
  const router = createMemoryRouter(
    [
      { id: 'c', path: '/', Component: CatalogPage, loader: () => data, ErrorBoundary: Failed },
      { path: '/engagement', element: <p>בקשה</p> },
    ],
    { hydrationData: { loaderData: { c: data } } },
  );
  render(<RouterProvider router={router} />);
}

function Failed() {
  return <p role="alert">אין גישה</p>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replaceShortlist([]);
});

describe('catalog page', () => {
  it('starts checking access in the loader without leaving a rejection unhandled', async () => {
    const failure = Promise.reject(new Error('offline'));
    vi.spyOn(rpc, 'identity').mockReturnValue(failure);
    const value = loader();
    expect(value.verified).toBe(failure);
    expect(value.today).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    await expect(value.verified).rejects.toThrow('offline');
  });

  it('shows the catalog, the add link for editors and the picked-suppliers bar', async () => {
    const value = state();
    const editor = {
      ...value,
      access: access({ editor: true, grants: [{ role: 'editor', unitId: 'u1' }] }),
    };
    vi.spyOn(reactCatalog, 'useCatalogSnapshot').mockReturnValue(editor);
    toggleShortlist(A);
    page(Promise.resolve({ userId: 'u', access: access() }));
    expect(await screen.findByRole('link', { name: 'הוספת ספק' })).toBeDefined();
    const bar = screen.getByRole('region', { name: 'בקשת התקשרות' });
    expect(bar.textContent).toMatch(/ספק אחד בבקשה/u);
    expect(screen.getByRole('link', { name: 'מעבר לבקשה' }).getAttribute('href')).toBe(
      '/engagement',
    );
    await userEvent.click(screen.getByRole('button', { name: 'ניקוי' }));
    expect(screen.queryByRole('region', { name: 'בקשת התקשרות' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'חיפוש ספקים' })).toBeDefined();
  });

  it('shows the request tray for ten seconds after an add, and not for an older list', () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(reactCatalog, 'useCatalogSnapshot').mockReturnValue(state());
      toggleShortlist(A);
      page(Promise.resolve({ userId: 'u', access: access() }));
      expect(screen.getByRole('region', { name: 'בקשת התקשרות' })).toBeDefined();
      act(() => {
        vi.advanceTimersByTime(10_001);
      });
      expect(screen.queryByRole('region', { name: 'בקשת התקשרות' })).toBeNull();
      cleanup();
      page(Promise.resolve({ userId: 'u', access: access() }));
      expect(screen.queryByRole('region', { name: 'בקשת התקשרות' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a user who is not an active member, and waits without a catalog', async () => {
    vi.spyOn(reactCatalog, 'useCatalogSnapshot').mockReturnValue(null);
    page(Promise.resolve({ userId: 'u', access: access({ member: false }) }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'הוספת ספק' })).toBeNull();
  });
});

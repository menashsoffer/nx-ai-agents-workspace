import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as rpc from '../../data/rpc.ts';
import { SupplierAreaLayout } from '../supplier-area-layout.tsx';
import { SupplierAreaLogin } from '../supplier-area-login.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderArea() {
  const router = createMemoryRouter(
    [
      {
        path: '/supplier-area',
        Component: SupplierAreaLayout,
        children: [{ path: 'login', Component: SupplierAreaLogin }],
      },
    ],
    { initialEntries: ['/supplier-area/login'] },
  );
  render(<RouterProvider router={router} />);
}

describe('the supplier area frame', () => {
  it('shows the area brand and the supplier sign-in, without staff tabs or sign-out', async () => {
    vi.spyOn(rpc, 'getAdminSession').mockReturnValue(null);
    renderArea();
    expect(
      await screen.findByRole('heading', { name: 'האזור האישי לספקי עיריית ירושלים' }),
    ).toBeDefined();
    expect(document.title).toBe('האזור האישי לספקים | עיריית ירושלים');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'יציאה' })).toBeNull();
  });

  it('offers sign-out to a signed-in person', async () => {
    vi.spyOn(rpc, 'getAdminSession').mockReturnValue({ token: 't', exp: 0, refresh: null });
    renderArea();
    expect(await screen.findByRole('button', { name: 'יציאה' })).toBeDefined();
  });
});

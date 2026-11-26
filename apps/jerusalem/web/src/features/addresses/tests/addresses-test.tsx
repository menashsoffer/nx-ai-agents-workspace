// The admin list of addresses that the map did not find (supplier spec 4.6).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import * as rpc from '../../../data/rpc.ts';
import { AddressesPage, loader } from '../addresses-page.tsx';
import type { AddressesToCheck } from '../api/addresses.ts';

const counts = { found: 700, approximate: 1, not_found: 1, waiting: 3 };
const value: AddressesToCheck = {
  counts,
  items: [
    {
      contact_id: 'c1',
      supplier_id: 's1',
      supplier_name: 'ספק א',
      value: 'אין כזה 1, ירושלים',
      result: 'not_found',
      map_label: null,
      checked_at: '2026-11-18T08:00:00Z',
    },
    {
      contact_id: 'c2',
      supplier_id: 's2',
      supplier_name: 'ספק ב',
      value: 'מכמורת',
      result: 'approximate',
      map_label: 'מכמורת, מועצה אזורית עמק חפר',
      checked_at: '2026-11-18T08:00:00Z',
    },
  ],
};

function show(data: AddressesToCheck) {
  const router = createMemoryRouter(
    [{ id: 'addresses', path: '/', Component: AddressesPage, loader: () => data }],
    { hydrationData: { loaderData: { addresses: data } } },
  );
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('addresses to check', () => {
  it('lists each unfound address with its supplier and what the map found', () => {
    show(value);
    expect(screen.getByRole('link', { name: 'ספק א' }).getAttribute('href')).toBe('/supplier/s1');
    expect(screen.getByRole('cell', { name: 'לא נמצאה' })).toBeDefined();
    expect(screen.getByRole('cell', { name: 'נמצאה רק העיר' })).toBeDefined();
    expect(screen.getByText('מכמורת, מועצה אזורית עמק חפר')).toBeDefined();
    expect(screen.getByText(/ממתינות לבדיקה/u).textContent).toContain('3');
  });

  it('says so when every checked address was found', () => {
    show({ counts, items: [] });
    expect(screen.getByText('אין כתובות לבדיקה')).toBeDefined();
  });

  it('loads for an admin only', async () => {
    const roles = vi.spyOn(rpc, 'requireRoles').mockResolvedValue(undefined as never);
    vi.spyOn(rpc, 'rpc').mockResolvedValue(value);
    expect(await loader()).toEqual(value);
    expect(roles).toHaveBeenCalledWith(['admin']);
  });
});

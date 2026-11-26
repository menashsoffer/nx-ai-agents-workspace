import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as rpc from '../../../data/rpc.ts';
import { clearScreenData } from '../../../data/screen-data.ts';
import { Component, loader } from '../registries-route.tsx';

const DETAIL = {
  registry_id: 'r',
  name: 'מאגר ריק',
  version_id: 'v',
  document: null,
  valid_from: null,
  valid_until: null,
  members: [],
};
const REVIEW = {
  registry_id: 'r',
  name: 'מאגר ברשימה',
  unit: 'מינהל',
  version_id: 'v',
  document: null,
  valid_from: null,
  valid_until: null,
  counts: { needs_review: 0, verified: 0, rejected: 0, expired: 0 },
};

function open(path: string) {
  const routes = [{ path: '/registries/:version?', Component, loader }];
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}
beforeEach(() => {
  vi.spyOn(rpc, 'requireRoles').mockResolvedValue({} as rpc.Identity);
  vi.spyOn(rpc, 'rpc').mockImplementation((name, _args, schema) =>
    Promise.resolve(schema.parse(name === 'registry_review' ? DETAIL : [REVIEW])),
  );
});
afterEach(() => {
  cleanup();
  clearScreenData();
  vi.restoreAllMocks();
});

describe('registries route', () => {
  it('shows the list without a version', async () => {
    open('/registries');
    expect(await screen.findByRole('link', { name: 'מאגר ברשימה' })).toBeDefined();
  });

  it('shows one registry, and says so when it has no suppliers', async () => {
    open('/registries/v');
    expect(await screen.findByRole('heading', { name: 'מאגר ריק' })).toBeDefined();
    expect(screen.getByText('אין ספקים במאגר')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'פתיחת מסמך המאגר' })).toBeNull();
  });
});

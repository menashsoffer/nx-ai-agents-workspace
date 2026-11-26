import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppRouter, createAdminRouter } from '../router.tsx';
import { routes, type RouteHandle } from '../routes.tsx';

afterEach(cleanup);

const screens = routes[0]?.children ?? [];

describe('route table', () => {
  it('gives every screen a title', () => {
    for (const route of screens.filter((r) => !r.index)) {
      expect((route.handle as RouteHandle | undefined)?.title, route.path).toBeTruthy();
    }
  });

  it.each(screens.filter((r) => typeof r.lazy === 'function').map((r) => [r.path, r] as const))(
    'loads the %s screen lazily',
    async (_path, route) => {
      const lazy = route.lazy as () => Promise<{ Component?: unknown; loader?: unknown }>;
      const loaded = await lazy();
      expect(typeof loaded.Component).toBe('function');
      if (route.path !== '*') expect(typeof loaded.loader).toBe('function');
    },
  );
});

describe('hash router', () => {
  it('renders the route for the address hash', async () => {
    window.location.hash = '#/no-such-screen';
    render(<AppRouter router={createAdminRouter()} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'הדף לא נמצא' })).toBeDefined();
    window.location.hash = '';
  });
});

import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ScreenError } from '../screen-error.tsx';
import { DataError } from '../../data/client.ts';
import { setAdminSession } from '../../data/rpc.ts';
afterEach(() => {
  cleanup();
  setAdminSession(null);
});
function failing(status: number) {
  const router = createMemoryRouter(
    [
      {
        path: '/users',
        element: <main />,
        loader: () => {
          throw new DataError(status);
        },
        errorElement: (
          <main>
            <ScreenError />
          </main>
        ),
      },
      { path: '/auth', element: <h1>מסך הכניסה</h1> },
    ],
    { initialEntries: ['/users'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
it('gives HTTP 403 a distinct explanation inside the existing main', async () => {
  failing(403);
  expect(await screen.findByRole('heading', { name: 'אין לך הרשאה למסך הזה' })).toBeDefined();
  expect(screen.getAllByRole('main')).toHaveLength(1);
});
it('sends a signed-out user to the sign-in screen instead of an empty page', async () => {
  const router = failing(401);
  expect(await screen.findByRole('heading', { name: 'מסך הכניסה' })).toBeDefined();
  expect(router.state.location.search).toBe('?next=%2Fusers');
});
it('offers to try again when the session was just renewed', async () => {
  setAdminSession({ token: 't', exp: Date.now() + 3_600_000, refresh: 'r' });
  failing(401);
  expect(await screen.findByRole('heading', { name: 'החיבור חודש' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'נסו שוב' })).toBeDefined();
});

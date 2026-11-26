import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, data, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RouteError } from '../route-error.tsx';

function failWith(error: unknown) {
  const router = createMemoryRouter([
    {
      path: '/',
      errorElement: <RouteError />,
      loader: () => {
        throw error;
      },
      element: <p>never</p>,
    },
  ]);
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('root error screen', () => {
  it('says the page does not exist for a 404 response', async () => {
    failWith(data(null, { status: 404 }));
    expect(await screen.findByRole('heading', { name: 'הדף לא נמצא' })).toBeDefined();
    expect(screen.getByText('הכתובת לא קיימת באתר. אולי הקישור ישן.')).toBeDefined();
  });

  it('offers to reload after any other failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    failWith(data(null, { status: 500 }));
    expect(await screen.findByRole('heading', { name: 'משהו השתבש' })).toBeDefined();
    // jsdom cannot reload a page; the click must still not break the error screen.
    await userEvent.click(screen.getByRole('button', { name: 'טעינה מחדש' }));
    expect(screen.getByRole('alert')).toBeDefined();
  });
});

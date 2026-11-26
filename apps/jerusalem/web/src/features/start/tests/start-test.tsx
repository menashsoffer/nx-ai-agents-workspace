import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { StartPage, STEPS } from '../start-page.tsx';

afterEach(cleanup);

describe('how to start', () => {
  it('lists the steps of one request in order, each with a link', () => {
    const router = createMemoryRouter([{ path: '/', Component: StartPage }]);
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 1, name: 'איך מתחילים' })).toBeDefined();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(STEPS.map((s) => s.title));
    expect(headings.at(-1)).toBe('בוחרים זוכה');
    expect(screen.getByRole('link', { name: 'אימות מאגרים' }).getAttribute('href')).toBe(
      '/registries',
    );
  });
});

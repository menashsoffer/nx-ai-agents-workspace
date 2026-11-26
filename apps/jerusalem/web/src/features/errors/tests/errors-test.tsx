// The errors screen (error-details-spec-he.md section 4).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import * as rpc from '../../../data/rpc.ts';
import type { ErrorsData } from '../api/errors.ts';
import { ErrorsPage, loader } from '../errors-page.tsx';
import { groupCases, type ErrorCase } from '../model/groups.ts';
import { sentence } from '../model/labels.ts';
import { viewOf } from '../model/period.ts';

function errorCase(id: number, overrides: Partial<ErrorCase> = {}): ErrorCase {
  return {
    id,
    created_at: `2026-11-22T15:${String(10 + id)}:00Z`,
    kind: 'system',
    screen: 'supplier-links',
    cause: 'superseded',
    request: 'catalog_snapshot',
    error_code: 'unexpected',
    boundary: 'route',
    role: 'admin',
    device: 'desktop',
    site_version: 'a1b2c3d',
    ...overrides,
  };
}
// Newest first, as error_cases returns them.
const CASES = [
  errorCase(9, { kind: 'offline', cause: 'network', screen: 'catalog', request: null }),
  errorCase(8, { kind: 'offline', cause: 'network', screen: 'catalog', request: null }),
  errorCase(7, { kind: 'offline', cause: 'network', screen: 'catalog', request: null }),
  errorCase(2, { role: 'editor', device: 'mobile' }),
  errorCase(1, { site_version: null }),
];

function show(data: ErrorsData) {
  const router = createMemoryRouter(
    [{ id: 'errors', path: '/', Component: ErrorsPage, loader: () => data }],
    { hydrationData: { loaderData: { errors: data } } },
  );
  render(<RouterProvider router={router} />);
}
const data = (cases = CASES): ErrorsData => ({
  view: viewOf(new URLSearchParams()),
  total: cases.length,
  groups: groupCases(cases),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('errors screen', () => {
  it('groups by screen, cause, request and kind, urgent first, then the most frequent', () => {
    const groups = groupCases(CASES);
    expect(groups.map((g) => [g.screen, g.cases.length, g.urgent])).toEqual([
      ['supplier-links', 2, true],
      ['catalog', 3, false],
    ]);
    const [links] = groups;
    expect(links?.roles).toBe(2);
    expect(links?.first).toBe('2026-11-22T15:11:00Z');
    expect(links?.last).toBe('2026-11-22T15:12:00Z');
    expect(links?.version).toBe('a1b2c3d');
  });

  it('says in one Hebrew sentence what happened', () => {
    const [links] = groupCases(CASES);
    expect(links && sentence(links)).toBe(
      'במסך "שיוכים ומסמכים": הבקשה בוטלה כי יצאה אחריה בקשה זהה. הבקשה לשרת: catalog_snapshot.',
    );
    const [http] = groupCases([errorCase(1, { cause: 'http', error_code: 'http_5xx' })]);
    expect(http && sentence(http)).toMatch(/השרת החזיר שגיאה, תקלה בשרת \(5xx\)/u);
  });

  it('shows the totals and opens a group to its cases', async () => {
    show(data());
    const stats = within(screen.getByRole('list', { name: 'סיכום' })).getAllByRole('listitem');
    expect(stats.map((s) => s.textContent)).toEqual(['5שגיאות', '2סיבות שונות', '2דורשות טיפול']);
    const summary = screen.getByText(/שיוכים ומסמכים: הבקשה בוטלה/u);
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
    expect(within(details as HTMLElement).getByText('דורש טיפול')).toBeDefined();
    await userEvent.click(summary);
    expect(details?.open).toBe(true);
    const table = within(details as HTMLElement).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('עורך')).toBeDefined();
    expect(within(table).getByText('נייד')).toBeDefined();
  });

  it('says so when there are no errors', () => {
    show(data([]));
    expect(screen.getByRole('heading', { name: 'אין שגיאות בתקופה הזו' })).toBeDefined();
  });

  it('asks the database for the period in the address, and can keep only urgent groups', async () => {
    const roles = vi.spyOn(rpc, 'requireRoles').mockResolvedValue(undefined as never);
    const call = vi.spyOn(rpc, 'rpc').mockResolvedValue(CASES);
    const loaded = await loader({ request: new Request('https://x.test/errors?days=30&urgent=1') });
    expect(roles).toHaveBeenCalledWith(['admin']);
    expect(call.mock.calls[0]?.slice(0, 2)).toEqual(['error_cases', { days: 30 }]);
    expect(loaded.total).toBe(5);
    expect(loaded.groups.map((g) => g.screen)).toEqual(['supplier-links']);
    await loader({ request: new Request('https://x.test/errors?days=all') });
    expect(call.mock.calls[1]?.[1]).toEqual({ days: null });
    expect(viewOf(new URLSearchParams('days=999')).period.days).toBe(7);
  });
});

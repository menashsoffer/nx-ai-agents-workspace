// The admin usage dashboard (usage-analytics-spec-he.md 4.3).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import * as rpc from '../../../data/rpc.ts';
import type { UsageData, UsageSummary } from '../api/usage.ts';
import { actionLabel, roleLabel, screenLabel } from '../model/labels.ts';
import { addDays, rangeOf } from '../model/range.ts';
import { formatDuration, funnels, totals } from '../model/summary.ts';
import { loader, UsagePage } from '../usage-page.tsx';

const range = rangeOf(new URLSearchParams('days=7'), '2026-11-22');
const summary: UsageSummary = {
  days: [
    { day: '2026-11-21', role: 'viewer', visitors: 2, visits: 3 },
    { day: '2026-11-21', role: 'supplier', visitors: 1, visits: 1 },
    { day: '2026-11-22', role: 'admin', visitors: 1, visits: 2 },
  ],
  screens: [
    { screen: 'catalog', views: 5, exits: 1, total_ms: 50_000 },
    { screen: 'engagement', views: 2, exits: 3, total_ms: 0 },
  ],
  actions: [
    { screen: 'catalog', action: 'catalog.search', count: 4 },
    { screen: 'catalog', action: 'catalog.filter.category', count: 1 },
  ],
  steps: [
    { screen: 'engagement', step: 1, visits: 4 },
    { screen: 'engagement', step: 2, visits: 1 },
  ],
  visit_ms: 400_000,
  ended_visits: 4,
};

function show(data: UsageData) {
  const router = createMemoryRouter(
    [{ id: 'usage', path: '/', Component: UsagePage, loader: () => data }],
    { hydrationData: { loaderData: { usage: data } } },
  );
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('usage dashboard', () => {
  it('starts with four numbers', () => {
    show({ range, summary });
    const stats = within(screen.getByRole('list', { name: 'סיכום' })).getAllByRole('listitem');
    expect(stats.map((s) => s.firstChild?.textContent)).toEqual(['6', '0.6', '1:40 דק׳', '5']);
  });

  it('shows every day of the period, screens with exits, actions and the wizard funnel', () => {
    show({ range, summary });
    const days = screen.getByRole('table', { name: /ביקורים ומשתמשים בכל יום/u });
    expect(within(days).getAllByRole('rowheader')).toHaveLength(7);
    const screens = screen.getByRole('table', { name: /לפי מספר הצפיות/u });
    expect(within(screens).getByText('איתור ספקים')).toBeDefined();
    expect(within(screens).getByText('75%')).toBeDefined();
    expect(screen.getByText('חיפוש ספקים')).toBeDefined();
    expect(screen.getByText('סינון: קטגוריה')).toBeDefined();
    expect(screen.getByRole('table', { name: /בקשות התקשרות: כמה ביקורים/u })).toBeDefined();
  });

  it('says so when there is nothing yet', () => {
    show({
      range,
      summary: { ...summary, days: [], screens: [], actions: [], steps: [], ended_visits: 0 },
    });
    expect(screen.getByText('אין עדיין צפיות בתקופה הזו.')).toBeDefined();
    expect(screen.getByText('אין עדיין לחיצות בתקופה הזו.')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'שלבים באשפים' })).toBeNull();
  });

  it('loads for an admin only, with the period and role from the address', async () => {
    const roles = vi.spyOn(rpc, 'requireRoles').mockResolvedValue(undefined as never);
    const call = vi.spyOn(rpc, 'rpc').mockResolvedValue(summary);
    const request = new Request('https://site.test/usage?days=90&role=supplier');
    const data = await loader({ request });
    expect(roles).toHaveBeenCalledWith(['admin']);
    expect(data.range.days).toBe(90);
    expect(call.mock.calls[0]?.[1]).toMatchObject({ only_role: 'supplier' });
  });
});

describe('usage model', () => {
  it('reads only known periods and roles', () => {
    expect(rangeOf(new URLSearchParams('days=5&role=root'), '2026-11-22')).toEqual({
      days: 30,
      from: '2026-10-24',
      to: '2026-11-22',
      role: null,
    });
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('labels slugs in Hebrew and keeps unknown ones as they are', () => {
    expect(screenLabel('supplier-area-login')).toBe('אזור אישי לספקים (login)');
    expect(screenLabel('mystery')).toBe('mystery');
    expect(actionLabel('catalog.toggle.showClosed')).toBe('הצגה: כולל מאגרים סגורים');
    expect(actionLabel('catalog.filter.new')).toBe('סינון: new');
    expect(actionLabel('x.y')).toBe('x.y');
    expect(roleLabel('supplier')).toBe('ספק');
    expect(roleLabel('robot')).toBe('robot');
  });

  it('formats durations and handles a period without ended visits', () => {
    expect(formatDuration(45_000)).toBe('45 שנ׳');
    expect(formatDuration(120_000)).toBe('2:00 דק׳');
    const empty = { ...summary, ended_visits: 0, days: [] };
    expect(totals(empty, range).averageVisitMs).toBe(0);
    expect(funnels(summary)[0]?.steps.map((s) => s.share)).toEqual([1, 0.25]);
  });
});

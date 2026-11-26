// The new request's details are kept for the tab (state-management-spec-he.md 5.2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { EngagementPage } from '../engagement-page.tsx';
import * as check from '../api/check.ts';
import * as engagement from '../api/engagement.ts';
import type { CheckResult } from '../model/result.ts';
import type { loader } from '../engagement-page.tsx';
type PageData = Awaited<ReturnType<typeof loader>>;

const result: CheckResult = {
  id: 9,
  route: 'zuta_4',
  regulation: '8(ד)(1)',
  approver: 'ועדת המכרזים',
  status: 'needs_review',
  allowed: false,
  requirements: [],
  missing: [],
  warnings: [],
  comparedValue: 120000,
  increasePercent: null,
  thresholdsSource: null,
  splittingChecked: false,
};
const supplier = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'ספק א',
  inactive: false,
  emails: [],
  phones: [],
  lastApproached: null,
};

function page() {
  const value: PageData = {
    suppliers: [supplier],
    units: [{ id: 'u1', name: 'אגף 1' }],
    today: '2026-11-17',
    saved: null,
  };
  const router = createMemoryRouter(
    [{ id: 'engagement', path: '/', Component: EngagementPage, loader: () => value }],
    { hydrationData: { loaderData: { engagement: value } } },
  );
  render(<RouterProvider router={router} />);
}
async function details() {
  await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
  // Focus moves to the step heading on the next frame; typing before it loses keys.
  await vi.waitFor(() => {
    expect(document.activeElement?.textContent).toBe('פרטי הבקשה');
  });
}
const estimate = () => screen.getByLabelText<HTMLInputElement>(/^אומדן בש״ח/u);
const subject = () => screen.getByLabelText<HTMLInputElement>(/^נושא/u);

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('new request draft', () => {
  it('fills the details again after leaving the page and coming back', async () => {
    page();
    await details();
    await userEvent.type(estimate(), '120000');
    await userEvent.type(subject(), 'ייעוץ ארגוני');
    await userEvent.click(screen.getByRole('checkbox', { name: /כולל מע״מ/u }));
    cleanup();
    page();
    await details();
    expect(estimate().value).toBe('120000');
    expect(subject().value).toBe('ייעוץ ארגוני');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /כולל מע״מ/u }).checked).toBe(
      true,
    );
  });

  it('starts empty after the request is saved, so a new request never edits the old one', async () => {
    vi.spyOn(engagement, 'saveRequest').mockResolvedValue('50000000-0000-4000-8000-000000000001');
    vi.spyOn(check, 'checkRoute').mockResolvedValue(result);
    page();
    await details();
    await userEvent.type(estimate(), '120000');
    await userEvent.type(subject(), 'ייעוץ ארגוני');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^יחידה/u }), 'u1');
    await userEvent.click(screen.getByRole('button', { name: 'בדיקת מסלול ושמירה ביחידה' }));
    expect(await screen.findByRole('heading', { name: 'תוצאה' })).toBeDefined();
    cleanup();
    page();
    await details();
    expect(estimate().value).toBe('');
    expect(screen.getByRole('button', { name: 'בדיקת מסלול בלבד' })).toBeDefined();
  });

  it('clears the details on request', async () => {
    page();
    await details();
    await userEvent.type(estimate(), '120000');
    await userEvent.click(screen.getByRole('button', { name: 'ניקוי הפרטים' }));
    expect(estimate().value).toBe('');
    cleanup();
    page();
    await details();
    expect(estimate().value).toBe('');
  });
});

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThresholdsPage } from '../thresholds-page.tsx';
import * as api from '../api/proposals.ts';
import * as dates from '../../../lib/dates.ts';
import { DataError } from '../../../data/client.ts';
import * as rpc from '../../../data/rpc.ts';
const proposal: api.Proposal = {
  id: 'proposal-1',
  valid_from: '2026-11-16',
  index_value: 120,
  no_tender_max: 100400,
  zuta4_max: 200000,
  zuta6_max: 300000,
  source: 'https://www.cbs.gov.il/index',
  status: 'pending',
};
const threshold: api.Threshold = {
  ...proposal,
  id: 'old',
  no_tender_max: 100000,
  source: 'הלמ״ס',
  valid_from: '2026-10-16',
  valid_until: '2026-11-15',
  is_official: false,
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function page(proposals: api.Proposal[] = [proposal], thresholds = [threshold]) {
  vi.spyOn(dates, 'israelToday').mockReturnValue('2026-11-10');
  const data = { proposals, thresholds };
  const router = createMemoryRouter(
    [{ path: '/', Component: ThresholdsPage, loader: () => data }],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  // A decision reloads the list through the screen data, not through the route loader.
  vi.spyOn(api, 'loadProposals').mockImplementation(() => Promise.resolve(data));
  return data;
}
/** The real decideProposal runs against a stubbed database that empties the list. */
function decideInDatabase(data: { proposals: api.Proposal[] }, outcome: unknown = null) {
  return vi.spyOn(rpc, 'rpc').mockImplementation(() => {
    data.proposals = [];
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  });
}
function expectSent(
  decide: ReturnType<typeof decideInDatabase>,
  approve: boolean,
  note: string | null,
) {
  expect(decide).toHaveBeenCalledWith(
    'decide_threshold_proposal',
    { proposal: 'proposal-1', approve, note },
    expect.anything(),
  );
}
async function approveDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'אישור הספים' }));
  return screen.getByRole('form', { name: 'אישור הספים מ-16.11.2026' });
}
describe('monthly threshold decisions', () => {
  it('shows the thresholds in force today and how much each proposed one changes', async () => {
    page();
    const current = await screen.findByRole('region', { name: 'הספים בתוקף היום' });
    expect(within(current).getByText('בתוקף מ-16.10.2026')).toBeDefined();
    expect(within(current).getByText('חישוב פנימי, לא פורסם רשמית')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'הצעה לספים מ-16.11.2026' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'מקור המדד' })).toBeDefined();
    const table = screen.getByRole('table', { name: /השוואת הספים/ });
    expect(within(table).getByText(/\+0\.4%/)).toBeDefined();
  });
  it('says when no thresholds are in force and no proposal waits', async () => {
    page([], []);
    expect(await screen.findByText(/אין ספים בתוקף היום/)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'אין הצעות ממתינות' })).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('approves only from the dialog that repeats the amounts', async () => {
    const decide = decideInDatabase(page());
    const form = await approveDialog();
    expect(within(form).getByText(/100,400/)).toBeDefined();
    expect(decide).not.toHaveBeenCalled();
    await userEvent.click(within(form).getByRole('button', { name: 'אישור הספים' }));
    expectSent(decide, true, null);
    expect(await screen.findByRole('heading', { name: 'אין הצעות ממתינות' })).toBeDefined();
  });
  it('keeps an error in the dialog and the proposal on screen', async () => {
    page();
    vi.spyOn(api, 'decideProposal').mockRejectedValue(new DataError(403));
    const form = await approveDialog();
    await userEvent.click(within(form).getByRole('button', { name: 'אישור הספים' }));
    expect((await within(form).findByRole('alert')).textContent).toContain('אין לך הרשאה');
    expect(screen.getByRole('table')).toBeDefined();
  });
  it('refreshes when another admin already decided the proposal', async () => {
    decideInDatabase(page(), new DataError(404));
    const form = await approveDialog();
    await userEvent.click(within(form).getByRole('button', { name: 'אישור הספים' }));
    expect(await screen.findByRole('heading', { name: 'אין הצעות ממתינות' })).toBeDefined();
  });
  it('rejects only with a reason, then refreshes', async () => {
    const decide = decideInDatabase(page());
    await userEvent.click(await screen.findByRole('button', { name: 'דחייה' }));
    const form = screen.getByRole('form', { name: 'דחיית ההצעה לספים מ-16.11.2026' });
    await userEvent.click(within(form).getByRole('button', { name: 'דחיית ההצעה' }));
    expect(await within(form).findByText('שדה חובה.')).toBeDefined();
    expect(decide).not.toHaveBeenCalled();
    await userEvent.type(within(form).getByRole('textbox', { name: /נימוק/ }), 'המדד תוקן');
    await userEvent.click(within(form).getByRole('button', { name: 'דחיית ההצעה' }));
    expectSent(decide, false, 'המדד תוקן');
    expect(await screen.findByRole('heading', { name: 'אין הצעות ממתינות' })).toBeDefined();
  });
  it('shows a failed rejection in the dialog and keeps the reason', async () => {
    page();
    vi.spyOn(api, 'decideProposal').mockRejectedValue(new Error('network'));
    await userEvent.click(await screen.findByRole('button', { name: 'דחייה' }));
    const form = screen.getByRole('form', { name: 'דחיית ההצעה לספים מ-16.11.2026' });
    await userEvent.type(within(form).getByRole('textbox', { name: /נימוק/ }), 'המדד תוקן');
    await userEvent.click(within(form).getByRole('button', { name: 'דחיית ההצעה' }));
    expect(await within(form).findByText(/תקלה במערכת/u)).toBeDefined();
    expect(within(form).getByRole<HTMLInputElement>('textbox', { name: /נימוק/ }).value).toBe(
      'המדד תוקן',
    );
  });
});

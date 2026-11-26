import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as rpc from '../../../data/rpc.ts';
import { refusal } from '../../../data/client.ts';
import type { Member, Members } from '../api/members.ts';
import { OurPeople } from '../components/our-people.tsx';

const ME: Member = {
  id: 'a1',
  first_name: 'דנה',
  last_name: 'כהן',
  job_title: 'מנכ"לית',
  email: 'dana@example.co.il',
  role: 'owner',
  method: 'email_match',
  created_at: '2026-11-22T08:00:00Z',
  is_me: true,
};
const WORKER: Member = {
  ...ME,
  id: 'a2',
  first_name: 'נועה',
  email: 'noa@x.co.il',
  role: 'member',
  is_me: false,
};
const LIST: Members = {
  members: [ME, WORKER],
  invites: [{ id: 'i1', email: 'later@x.co.il', role: 'member', expires_at: '2026-12-06' }],
};

function show(list: Members = LIST) {
  const router = createMemoryRouter(
    [
      {
        id: 'area',
        path: '/',
        element: <OurPeople supplierId="s1" list={list} />,
        loader: () => null,
      },
    ],
    { hydrationData: { loaderData: { area: null } } },
  );
  render(<RouterProvider router={router} />);
}
const calls = () => vi.spyOn(rpc, 'rpc').mockResolvedValue(null);

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('our people', () => {
  it('lists the people and open invites, and keeps the only owner', () => {
    show();
    const [mine, theirs] = screen.getAllByRole('listitem');
    if (!mine || !theirs) throw new Error('two people expected');
    expect(mine.textContent).toContain('דנה כהן (אני)');
    expect(mine.textContent).toContain('מורשה');
    expect(within(mine).queryByRole('button')).toBeNull();
    expect(within(theirs).getByRole('button', { name: 'הסרה' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'הזמנה ל-later@x.co.il' })).toBeTruthy();
  });

  it('checks the address, then invites and gives the link to pass on', async () => {
    const rpcCall = vi.spyOn(rpc, 'rpc').mockResolvedValue('i2');
    show();
    const email = screen.getByLabelText(/דוא"ל/);
    await userEvent.type(email, 'noa@x.co.il');
    await userEvent.click(screen.getByRole('button', { name: 'הזמנת עובד' }));
    expect(await screen.findByText('האדם הזה כבר משויך לספק.')).toBeTruthy();
    expect(rpcCall).not.toHaveBeenCalled();
    await userEvent.clear(email);
    await userEvent.type(email, ' New@X.co.il');
    await userEvent.selectOptions(screen.getByLabelText(/הרשאה/), 'owner');
    await userEvent.click(screen.getByRole('button', { name: 'הזמנת עובד' }));
    expect(await screen.findByText(/ההזמנה ל-new@x.co.il נשמרה/)).toBeTruthy();
    expect(rpcCall).toHaveBeenCalledWith(
      'portal_invite_member',
      { invite: { supplier_id: 's1', email: 'new@x.co.il', role: 'owner' } },
      expect.anything(),
    );
    expect((email as HTMLInputElement).value).toBe('');
  });

  it('withdraws an open invite', async () => {
    const rpcCall = calls();
    show();
    await userEvent.click(screen.getByRole('button', { name: 'ביטול ההזמנה' }));
    expect(rpcCall).toHaveBeenCalledWith(
      'portal_cancel_invite',
      { invite_id: 'i1' },
      expect.anything(),
    );
  });

  it('removes a colleague after asking, and shows a refusal', async () => {
    const rpcCall = vi
      .spyOn(rpc, 'rpc')
      .mockRejectedValueOnce(refusal(400, 'reason:already_decided', 'rule'));
    show();
    const dialog = screen.getByRole('dialog', { hidden: true });
    dialog.setAttribute('open', '');
    expect(within(dialog).getByText('להסיר את נועה כהן?')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'הסרה' }));
    expect(await within(dialog).findByText(/כבר הוחלט/)).toBeTruthy();
    rpcCall.mockResolvedValueOnce(null);
    await userEvent.click(within(dialog).getByRole('button', { name: 'הסרה' }));
    expect(rpcCall).toHaveBeenLastCalledWith(
      'portal_remove_member',
      { account_id: 'a2' },
      expect.anything(),
    );
  });
});

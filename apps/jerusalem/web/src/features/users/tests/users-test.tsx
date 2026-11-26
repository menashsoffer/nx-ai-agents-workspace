import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { UsersPage } from '../users-page.tsx';
import * as api from '../api/users.ts';
import * as changes from '../api/changes.ts';
import { DataError } from '../../../data/client.ts';
import * as rpc from '../../../data/rpc.ts';
const target: api.Profile = {
  user_id: 'target',
  first_name: 'משתמש',
  last_name: 'לדוגמה',
  email: 'user@example.test',
  job_title: 'יועץ',
  unit_id: 'own',
  purpose: 'עבודה מול מאגרי הספקים',
  status: 'pending',
};
function data(): Awaited<ReturnType<typeof api.loadUsers>> {
  return {
    who: {
      userId: 'admin',
      access: {
        state: 'active' as const,
        member: true,
        admin: true,
        editor: true,
        manager: false,
        grants: [{ role: 'admin' as const, unitId: null }],
      },
    },
    profiles: [
      target,
      { ...target, user_id: 'admin', first_name: 'מנהל', status: 'active' as const },
    ],
    grants: [] as api.GrantRow[],
    units: [
      { id: 'own', name: 'יחידה א' },
      { id: 'other', name: 'יחידה ב' },
    ],
    changes: null,
    now: 0,
  };
}
function page(value: ReturnType<typeof data>) {
  const router = createMemoryRouter(
    [{ id: 'users', path: '/', Component: UsersPage, loader: () => value }],
    {
      initialEntries: ['/'],
      hydrationData: { loaderData: { users: value } },
    },
  );
  render(<RouterProvider router={router} />);
}
/**
 * The real write function runs against a stubbed database; `change` is what the database does.
 * The screen then reloads through the screen data, which reads `value` again.
 */
function database(value: ReturnType<typeof data>, change: () => void) {
  vi.spyOn(api, 'loadUsers').mockImplementation(() => Promise.resolve(value));
  return vi.spyOn(rpc, 'rpc').mockImplementation(() => {
    change();
    return Promise.resolve(null);
  });
}
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
const CHANGE: changes.PendingChange = {
  id: 'c1',
  user_id: 'target',
  kind: 'details',
  role: null,
  unit_id: null,
  grant_id: null,
  details: { job_title: 'יועצת בכירה' },
  reason: 'קיבלתי קידום',
  status: 'pending',
  created_at: '2026-11-18T08:00:00Z',
  decided_at: null,
  decision_note: null,
};
describe('pending change requests', () => {
  it('shows what changes and why, and approves it', async () => {
    const value = { ...data(), changes: [CHANGE] };
    page(value);
    const decide = database(value, () => {
      value.changes = [];
    });
    const card = await screen.findByRole('article', { name: /עדכון פרטים: תפקיד בעירייה/ });
    expect(within(card).getByText('תפקיד בעירייה: יועצת בכירה')).toBeDefined();
    expect(within(card).getByText(/הסיבה: קיבלתי קידום/)).toBeDefined();
    await userEvent.click(within(card).getByRole('button', { name: 'אישור' }));
    expect(decide).toHaveBeenCalledWith(
      'decide_access_change',
      { request_id: 'c1', approve: true, note: null },
      expect.anything(),
    );
    expect(await screen.findByRole('heading', { name: 'אין בקשות שינוי ממתינות' })).toBeDefined();
  });
  it('needs a reason to reject and reports a refusal', async () => {
    page({ ...data(), changes: [CHANGE] });
    const decide = vi
      .spyOn(changes, 'decideChange')
      .mockRejectedValue(new DataError(403, 'אין הרשאה.'));
    const card = await screen.findByRole('article', { name: /עדכון פרטים/ });
    await userEvent.click(within(card).getByRole('button', { name: 'דחייה' }));
    const note = within(card).getByRole('textbox', { name: /נימוק/ });
    await waitFor(() => {
      expect(note.getAttribute('aria-invalid')).toBe('true');
    });
    expect(decide).not.toHaveBeenCalled();
    await userEvent.type(note, 'אין תקן פנוי');
    await userEvent.click(within(card).getByRole('button', { name: 'דחייה' }));
    expect(decide).toHaveBeenCalledWith('c1', false, 'אין תקן פנוי');
    expect(await within(card).findByRole('alert')).toBeDefined();
  });
  it('leaves the section out where change requests are not available', async () => {
    page(data());
    expect(await screen.findByRole('heading', { name: 'בקשות גישה' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'בקשות שינוי ממתינות' })).toBeNull();
  });
});
const ADMIN_GRANT: api.GrantRow = {
  id: 'grant',
  user_id: 'admin',
  role: 'viewer',
  unit_id: 'own',
  expires_at: null,
  revoked_at: null,
};
describe('access requests', () => {
  it('opens on the requests and rejects only with a reason', async () => {
    const value = data();
    page(value);
    const review = vi.spyOn(api, 'reviewProfile').mockResolvedValue();
    expect(await screen.findByRole('link', { name: 'בקשות ממתינות (1)' })).toBeDefined();
    const card = screen.getByRole('article', { name: 'בקשת גישה של משתמש לדוגמה' });
    await userEvent.click(within(card).getByRole('button', { name: 'דחיית הבקשה' }));
    const dialog = screen.getByRole('form', { name: 'דחיית הבקשה של משתמש לדוגמה' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'דחיית הבקשה' }));
    const note = within(dialog).getByRole('textbox', { name: /נימוק/ });
    await waitFor(() => {
      expect(note.getAttribute('aria-invalid')).toBe('true');
    });
    expect(review).not.toHaveBeenCalled();
    await userEvent.type(note, 'לא עובד ביחידה');
    await userEvent.click(within(dialog).getByRole('button', { name: 'דחיית הבקשה' }));
    expect(review).toHaveBeenCalledWith('target', 'rejected', 'לא עובד ביחידה');
  });
  it('does not present self-approval controls', async () => {
    const value = data();
    value.who.userId = 'target';
    page(value);
    expect(await screen.findByText('אין לאשר את הבקשה של עצמך.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'אישור הגישה' })).toBeNull();
  });
  it('approves with the chosen role and the request unit in one step', async () => {
    const value = data();
    page(value);
    const approve = database(value, () => {
      value.profiles = value.profiles.map((p) => ({ ...p, status: 'active' }));
    });
    await userEvent.click(await screen.findByRole('button', { name: 'אישור הגישה' }));
    const dialog = screen.getByRole('form', { name: 'אישור הגישה של משתמש לדוגמה' });
    expect(within(dialog).getByRole<HTMLSelectElement>('combobox', { name: /יחידה/ }).value).toBe(
      'own',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'תפקיד' }),
      'editor',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'אישור ומתן התפקיד' }));
    expect(approve).toHaveBeenCalledWith(
      'approve_profile',
      { target_user: 'target', wanted_role: 'editor', target_unit: 'own', note: null },
      expect.anything(),
    );
    expect(await screen.findByRole('link', { name: 'בקשות ממתינות (0)' })).toBeDefined();
  });
});
describe('users and roles', () => {
  it('opens on the users when nothing waits, and searches by name or email', async () => {
    const value = data();
    value.profiles = [
      { ...target, status: 'active' },
      { ...target, user_id: 'admin', first_name: 'מנהל', email: 'boss@x.test', status: 'active' },
    ];
    page(value);
    expect(await screen.findByRole('link', { name: 'משתמשים (2)' })).toBeDefined();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    await userEvent.type(screen.getByRole('searchbox'), 'BOSS');
    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(2);
    });
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'אין כזה');
    expect(await screen.findByRole('heading', { name: 'לא נמצאו משתמשים' })).toBeDefined();
  });
  it('offers a manager only viewer/editor and managed units', async () => {
    const value = data();
    value.who.access = {
      ...value.who.access,
      admin: false,
      manager: true,
      grants: [{ role: 'unit_manager', unitId: 'own' }],
    };
    page(value);
    await userEvent.click(await screen.findByRole('button', { name: 'מתן תפקיד' }));
    const dialog = screen.getByRole('form', { name: 'מתן תפקיד' });
    const role = within(dialog).getByRole('combobox', { name: 'תפקיד' });
    expect(within(role).queryByRole('option', { name: 'מנהל מערכת' })).toBeNull();
    const unit = within(dialog).getByRole('combobox', { name: /יחידה/ });
    expect(within(unit).queryByRole('option', { name: 'יחידה ב' })).toBeNull();
  });
  it('gives a role to the row it was opened from, and shows a refusal', async () => {
    const value = data();
    page(value);
    vi.spyOn(api, 'addGrant').mockRejectedValue(new DataError(403));
    await userEvent.click(await screen.findByRole('link', { name: /משתמשים/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'מתן תפקיד למנהל לדוגמה' }));
    const dialog = screen.getByRole('form', { name: 'מתן תפקיד' });
    expect(within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'משתמש' }).value).toBe(
      'admin',
    );
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /יחידה/ }), 'own');
    await userEvent.click(within(dialog).getByRole('button', { name: 'מתן התפקיד' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('אין לך הרשאה');
  });
  it('removes a role only after confirming', async () => {
    const value = data();
    value.grants = [ADMIN_GRANT];
    page(value);
    const remove = database(value, () => {
      value.grants = [];
    });
    await userEvent.click(await screen.findByRole('link', { name: /משתמשים/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'הסרת התפקיד צופה · יחידה א ממנהל לדוגמה' }),
    );
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText('להסיר את התפקיד צופה · יחידה א ממנהל לדוגמה?')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'הסרת התפקיד' }));
    expect(remove).toHaveBeenCalledWith('revoke_role', { grant_id: 'grant' }, expect.anything());
    expect(await screen.findByText('אין תפקיד')).toBeDefined();
  });
});

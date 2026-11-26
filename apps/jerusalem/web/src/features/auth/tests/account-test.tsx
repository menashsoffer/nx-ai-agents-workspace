import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthPage } from '../auth-page.tsx';
import * as api from '../api/account.ts';
import type { Account, ChangeRequest } from '../api/account.ts';
import type { Access } from '../../../data/access.ts';
import * as site from '../../../data/site.ts';

const ACTIVE: Access = {
  state: 'active',
  member: true,
  admin: false,
  editor: true,
  manager: false,
  grants: [{ role: 'editor', unitId: 'u1' }],
};
const UNITS = [
  { id: 'u1', name: 'אגף החינוך' },
  { id: 'u2', name: 'אגף התרבות' },
];
const PROFILE = {
  first_name: 'דנה',
  last_name: 'כהן',
  email: 'dana@example.test',
  job_title: 'מהנדסת',
  phone: null,
  unit_id: 'u1',
  created_at: '2026-11-17T08:00:00Z',
};
const GRANT = { id: 'g1', role: 'editor' as const, unit_id: 'u1' };

function change(over: Partial<ChangeRequest>): ChangeRequest {
  return {
    id: 'c1',
    kind: 'details',
    role: null,
    unit_id: null,
    grant_id: null,
    details: { job_title: 'מהנדסת בכירה' },
    reason: 'קידום',
    status: 'pending',
    created_at: '2026-11-18T08:00:00Z',
    decided_at: null,
    decision_note: null,
    ...over,
  };
}

function page(account: Partial<Account>, access: Access = ACTIVE, entry = '/auth') {
  const full: Account = {
    profile: PROFILE,
    units: UNITS,
    grants: [GRANT],
    changes: [],
    signedInAt: null,
    admin: false,
    ...account,
  };
  const router = createMemoryRouter(
    [
      {
        path: '/auth',
        Component: AuthPage,
        loader: () => ({ who: { userId: 'me', access }, account: full, expired: false }),
      },
    ],
    { initialEntries: [entry] },
  );
  render(<RouterProvider router={router} />);
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
});

describe('my account', () => {
  it('shows details and role tags, and sends only changed details for approval', async () => {
    const ask = vi.spyOn(api, 'askDetails').mockResolvedValue();
    page({});
    expect(await screen.findByRole('heading', { name: 'האזור האישי', level: 1 })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'דנה כהן', level: 2 })).toBeDefined();
    expect(screen.getByText('17.11.2026')).toBeDefined();
    expect(screen.getByText('לא ידוע')).toBeDefined();
    expect(screen.getByText('dana@example.test')).toBeDefined();
    expect(screen.getByText('עורך · אגף החינוך')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'עריכת הפרטים שלי' }));
    const form = screen.getByRole('form', { name: 'עריכת הפרטים שלי' });
    const job = within(form).getByRole('textbox', { name: /תפקיד בעירייה/ });
    await userEvent.clear(job);
    await userEvent.type(job, 'מהנדסת בכירה');
    await userEvent.type(
      within(form).getByRole('textbox', { name: /סיבת השינוי/ }),
      'קיבלתי קידום',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'שליחת השינוי לאישור' }));
    expect(ask).toHaveBeenCalledWith({ job_title: 'מהנדסת בכירה' }, 'קיבלתי קידום');
  });

  it('names the field to fix and refuses an unchanged form', async () => {
    const ask = vi.spyOn(api, 'askDetails').mockResolvedValue();
    page({}, ACTIVE, '/auth?part=details');
    const form = await screen.findByRole('form', { name: 'עריכת הפרטים שלי' });
    await userEvent.click(within(form).getByRole('button', { name: 'שליחת השינוי לאישור' }));
    expect(await within(form).findByText('שדה חובה.')).toBeDefined();
    await userEvent.type(within(form).getByRole('textbox', { name: /סיבת השינוי/ }), 'סתם בדיקה');
    await userEvent.click(within(form).getByRole('button', { name: 'שליחת השינוי לאישור' }));
    expect(await screen.findByText('לא שונה אף פרט.')).toBeDefined();
    expect(ask).not.toHaveBeenCalled();
  });

  it('shows a waiting details change that can be cancelled, and the request history', async () => {
    const cancel = vi.spyOn(api, 'cancelChange').mockResolvedValue();
    const rejected = change({
      id: 'c2',
      kind: 'move_unit',
      details: null,
      unit_id: 'u2',
      status: 'rejected',
      decision_note: 'אין תקן',
    });
    page({ changes: [change({}), rejected] });
    expect(await screen.findByText('השינוי נשלח ב-18.11.2026 וממתין לאישור.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'עריכת הפרטים שלי' })).toBeNull();
    expect(screen.getByText('מעבר יחידה: אגף התרבות')).toBeDefined();
    expect(screen.getByText('סיבת הדחייה: אין תקן')).toBeDefined();
    const [first] = screen.getAllByRole('button', { name: 'ביטול הבקשה' });
    if (first) await userEvent.click(first);
    expect(cancel).toHaveBeenCalledWith('c1');
  });

  it('asks for a role change with the fields the kind needs', async () => {
    const ask = vi.spyOn(api, 'askChange').mockResolvedValue();
    page({});
    await userEvent.click(
      await screen.findByRole('button', { name: 'בקשה לשינוי תפקיד או יחידה' }),
    );
    const form = await screen.findByRole('form', { name: 'בקשה לשינוי תפקיד או יחידה' });
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: /מה לבקש/ }),
      'add_role',
    );
    await userEvent.type(within(form).getByRole('textbox', { name: /למה/ }), 'אני מנהלת צוות');
    await userEvent.click(within(form).getByRole('button', { name: 'שליחת הבקשה' }));
    expect(await within(form).findAllByText('שדה חובה.')).toHaveLength(1);
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: /^תפקיד/ }),
      'unit_manager',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'שליחת הבקשה' }));
    await vi.waitFor(() => {
      const unit = within(form).getByRole('combobox', { name: /יחידה/ });
      expect(unit.getAttribute('aria-invalid')).toBe('true');
    });
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: /יחידה/ }), 'u1');
    await userEvent.click(within(form).getByRole('button', { name: 'שליחת הבקשה' }));
    expect(ask).toHaveBeenCalledWith({
      kind: 'add_role',
      role: 'unit_manager',
      unit_id: 'u1',
      grant_id: '',
      reason: 'אני מנהלת צוות',
    });
  });

  it('shows the last sign-in and opens the details form from its tile', async () => {
    page({ signedInAt: '2026-11-18T06:55:00Z' });
    expect(await screen.findByText(/18\.11\.2026/)).toBeDefined();
    expect(screen.queryByRole('form', { name: 'עריכת הפרטים שלי' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'עריכת הפרטים שלי' }));
    expect(screen.getByRole('form', { name: 'עריכת הפרטים שלי' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'יציאה מהמערכת' })).toBeDefined();
  });

  it('keeps details read-only where change requests are not available', async () => {
    page({ changes: null });
    expect(await screen.findByText('בקשות שינוי עדיין לא זמינות כאן.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'עריכת הפרטים שלי' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'בקשה לשינוי תפקיד או יחידה' })).toBeNull();
  });
});

describe('access request', () => {
  const NEW: Access = {
    ...ACTIVE,
    state: 'unregistered',
    member: false,
    editor: false,
    grants: [],
  };

  it('sends a checked access request and refreshes the access', async () => {
    const send = vi.spyOn(api, 'requestAccess').mockResolvedValue();
    const clear = vi.spyOn(site, 'clearCatalog').mockResolvedValue();
    page({ profile: null, grants: [], changes: null }, NEW);
    const form = await screen.findByRole('form', { name: 'בקשת גישה' });
    await userEvent.click(within(form).getByRole('button', { name: 'שליחת הבקשה' }));
    expect(await within(form).findAllByText('שדה חובה.')).toHaveLength(5);
    await userEvent.type(within(form).getByRole('textbox', { name: /שם פרטי/ }), 'דנה');
    await userEvent.type(within(form).getByRole('textbox', { name: /שם משפחה/ }), 'כהן');
    await userEvent.type(within(form).getByRole('textbox', { name: /תפקיד בעירייה/ }), 'מהנדסת');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: /יחידה/ }), 'u2');
    await userEvent.type(
      within(form).getByRole('textbox', { name: /למה צריך גישה/ }),
      'איתור יועצים',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'שליחת הבקשה' }));
    expect(send).toHaveBeenCalledWith('me', {
      first_name: 'דנה',
      last_name: 'כהן',
      job_title: 'מהנדסת',
      unit_id: 'u2',
      phone: null,
      purpose: 'איתור יועצים',
    });
    expect(clear).toHaveBeenCalledWith('me', false);
  });

  it('shows a refusal from the database above the form', async () => {
    vi.spyOn(api, 'requestAccess').mockRejectedValue(new Error('מספר טלפון לא תקין.'));
    page({ profile: null, grants: [], changes: null }, NEW);
    const form = await screen.findByRole('form', { name: 'בקשת גישה' });
    await userEvent.type(within(form).getByRole('textbox', { name: /שם פרטי/ }), 'דנה');
    await userEvent.type(within(form).getByRole('textbox', { name: /שם משפחה/ }), 'כהן');
    await userEvent.type(within(form).getByRole('textbox', { name: /תפקיד בעירייה/ }), 'מהנדסת');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: /יחידה/ }), 'u1');
    await userEvent.type(
      within(form).getByRole('textbox', { name: /למה צריך גישה/ }),
      'איתור יועצים',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'שליחת הבקשה' }));
    expect((await screen.findByRole('alert')).textContent).toContain('מספר טלפון לא תקין.');
  });
});

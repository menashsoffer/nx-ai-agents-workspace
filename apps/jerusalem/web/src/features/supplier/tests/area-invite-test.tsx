import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { compactCatalog } from '../../../data/compact-catalog.ts';
import { supplierDetail, type SupplierDetail } from '../../../data/supplier-detail.ts';
import * as rpc from '../../../data/rpc.ts';
import { DataError, refusal } from '../../../data/client.ts';
import { client, SUPPLIER, wireCatalog, wireDetail } from '../../../../tests/catalog-fixture.ts';
import { AreaInvite } from '../components/area-invite.tsx';
import { areaLink } from '../api/invite.ts';

const ACCOUNT = {
  id: 'a1',
  role: 'owner',
  status: 'active',
  method: 'email_match',
  created_at: '2026-11-22T08:00:00Z',
  decided_at: null,
  decision_note: null,
  email: 'dana@example.co.il',
  first_name: 'דנה',
  last_name: 'כהן',
  job_title: null,
};

function answer(handler: (name: string) => unknown) {
  return vi.spyOn(rpc, 'rpc').mockImplementation((name, _args, schema) => {
    try {
      return Promise.resolve(schema.parse(handler(name)));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

let invites: unknown[] = [];
beforeEach(() => {
  invites = [];
  vi.spyOn(rpc, 'rows').mockImplementation((_table, _filters, schema) =>
    Promise.resolve(schema.parse(invites)),
  );
  // jsdom has no native dialog close; the real one is checked in Chromium.
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function detail(emails: string[]): Promise<SupplierDetail> {
  const api = client(() => Response.json(wireDetail({ audit: null })));
  const data = await supplierDetail(api, compactCatalog(wireCatalog()), SUPPLIER);
  const sample = data.contacts[0];
  if (!sample) throw new Error('fixture has no contact');
  data.contacts = emails.map((value) => ({ ...sample, kind: 'email', value, is_valid: true }));
  return data;
}

describe('the supplier area invite', () => {
  it('builds the area address from the site address', () => {
    expect(areaLink({ origin: 'https://x.test', pathname: '/admin.html' })).toBe(
      'https://x.test/admin.html#/supplier-area',
    );
  });

  it('says why there is no invite when the supplier has no valid email', async () => {
    answer(() => []);
    render(<AreaInvite data={await detail([])} />);
    expect(screen.queryByRole('form')).toBeNull();
    expect(await screen.findByText(/אין לספק דוא"ל תקין/)).toBeDefined();
    expect(await screen.findByText(/אף אחד עוד לא משויך/)).toBeDefined();
  });

  it('lists who is linked, and lets an admin end a link with a reason', async () => {
    const call = answer((name) => (name === 'supplier_area_accounts' ? [ACCOUNT] : null));
    render(<AreaInvite data={await detail([])} admin />);
    expect(await screen.findByText('דנה כהן')).toBeDefined();
    expect(screen.getByText(/פעיל · בעלים · התאמת דוא"ל/)).toBeDefined();
    const dialog = document.querySelector('dialog');
    dialog?.setAttribute('open', '');
    const form = screen.getByRole('form', { name: 'ביטול השיוך לאזור האישי' });
    await userEvent.click(within(form).getByRole('button', { name: 'ביטול השיוך' }));
    expect(await within(form).findByText(/צריך לכתוב סיבה/)).toBeDefined();
    await userEvent.type(within(form).getByLabelText(/סיבה/), 'עזב את הספק');
    await userEvent.click(within(form).getByRole('button', { name: 'ביטול השיוך' }));
    expect(call).toHaveBeenCalledWith(
      'revoke_supplier_account',
      { account_id: 'a1', note: 'עזב את הספק' },
      expect.anything(),
    );
  });

  it('shows an editor the list without a revoke button, and a load failure', async () => {
    answer(() => [{ ...ACCOUNT, status: 'revoked', decision_note: 'עזב', first_name: null }]);
    render(<AreaInvite data={await detail([])} />);
    expect(await screen.findByText(/בוטל · בעלים/)).toBeDefined();
    expect(screen.getByText(/הסיבה: עזב/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'ביטול השיוך' })).toBeNull();
    cleanup();
    vi.spyOn(rpc, 'rpc').mockRejectedValue(new DataError(500));
    render(<AreaInvite data={await detail([])} />);
    expect(await screen.findByRole('alert')).toBeDefined();
  });

  it('shows the only email without a list, and invites it', async () => {
    const call = answer((name) => (name === 'supplier_area_accounts' ? [] : 'i1'));
    render(<AreaInvite data={await detail(['office@example.co.il'])} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(/ההזמנה תישמר לדוא"ל/).textContent).toContain('office@example.co.il');
    await userEvent.click(screen.getByRole('button', { name: 'הזמנה לאזור האישי' }));
    expect(call).toHaveBeenCalledWith(
      'invite_supplier_account',
      { supplier_id: SUPPLIER, email: 'office@example.co.il' },
      expect.anything(),
    );
    expect(await screen.findByText(/המערכת לא שולחת דוא"ל/)).toBeDefined();
  });

  it('lets the user choose when the supplier has several emails', async () => {
    const call = answer((name) => (name === 'supplier_area_accounts' ? [] : 'i1'));
    render(<AreaInvite data={await detail(['a@example.co.il', 'b@example.co.il'])} />);
    const list = screen.getByRole('combobox', { name: /דוא"ל להזמנה/ });
    await userEvent.selectOptions(list, 'b@example.co.il');
    await userEvent.click(screen.getByRole('button', { name: 'הזמנה לאזור האישי' }));
    expect(call).toHaveBeenCalledWith(
      'invite_supplier_account',
      { supplier_id: SUPPLIER, email: 'b@example.co.il' },
      expect.anything(),
    );
  });

  it('shows the refusal when the invite fails', async () => {
    answer((name) => {
      if (name === 'supplier_area_accounts') return [];
      throw refusal(400, 'reason:invite_email_unknown', 'rule');
    });
    render(<AreaInvite data={await detail(['office@example.co.il'])} />);
    await userEvent.click(screen.getByRole('button', { name: 'הזמנה לאזור האישי' }));
    expect(await screen.findByRole('alert')).toBeDefined();
  });

  it('shows the link to copy and how long each invite has been out', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-22T10:00:00Z'), toFake: ['Date'] });
    invites = [
      {
        id: 'i1',
        email: 'office@example.co.il',
        created_at: '2026-11-19T09:00:00Z',
        expires_at: '2026-12-03T09:00:00Z',
        accepted_at: null,
      },
    ];
    answer(() => []);
    render(<AreaInvite data={await detail(['office@example.co.il'])} />);
    expect(await screen.findByText(/לפני 3 ימים/)).toBeDefined();
    expect(screen.getByText(/נשארו עוד 10 ימים/)).toBeDefined();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('value')).toBe('3');
    expect(bar.getAttribute('max')).toBe('14');
    expect(screen.getByRole('button', { name: 'העתקת הקישור לאזור האישי' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'העתקת ההודעה ל-office@example.co.il' }),
    ).toBeDefined();
    vi.useRealTimers();
  });

  it('copies the link to the clipboard', async () => {
    const user = userEvent.setup();
    answer(() => []);
    render(<AreaInvite data={await detail([])} />);
    await user.click(screen.getByRole('button', { name: 'העתקת הקישור לאזור האישי' }));
    expect(await navigator.clipboard.readText()).toBe(areaLink());
  });
});

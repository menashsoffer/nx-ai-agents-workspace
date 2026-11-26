import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { compactCatalog } from '../../../data/compact-catalog.ts';
import { supplierDetail, type SupplierDetail } from '../../../data/supplier-detail.ts';
import type { ChangeRequest } from '../../../data/supplier-changes.ts';
import * as rpc from '../../../data/rpc.ts';
import * as site from '../../../data/site.ts';
import { client, SUPPLIER, wireCatalog, wireDetail } from '../../../../tests/catalog-fixture.ts';
import { EditDialog } from '../components/edit-dialog.tsx';
import { PendingChanges } from '../components/pending-changes.tsx';
import { checkText } from '../model/change-checks.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function dialogWith(contacts: { id: string; kind: string; value: string }[]) {
  const api = client(() => Response.json(wireDetail({ audit: null })));
  const data: SupplierDetail = await supplierDetail(api, compactCatalog(wireCatalog()), SUPPLIER);
  const [base] = data.contacts;
  if (!base) throw new Error('fixture has no contact');
  data.contacts = contacts.map((c) => ({ ...base, ...c, status: 'current' }));
  const router = createMemoryRouter([
    {
      path: '/',
      element: <EditDialog data={data} editor admin={false} today="2026-11-22" />,
      loader: () => null,
    },
  ]);
  render(<RouterProvider router={router} />);
  const dialog = await waitFor(() => {
    const found = document.querySelector('dialog');
    if (!found) throw new Error('no dialog yet');
    return found;
  });
  dialog.setAttribute('open', '');
}

function mockDatabase() {
  vi.spyOn(rpc, 'sessionToken').mockReturnValue('token');
  vi.spyOn(rpc, 'freshToken').mockResolvedValue('token');
  vi.spyOn(site, 'loadSnapshot').mockResolvedValue(
    {} as Awaited<ReturnType<typeof site.loadSnapshot>>,
  );
  return vi.spyOn(rpc, 'rpc').mockImplementation((name: string) => {
    const checks = [{ check: 'contact_removal', outcome: 'green', name: '054-2244973' }];
    if (name === 'check_supplier_change') return Promise.resolve({ outcome: 'green', checks });
    return Promise.resolve({ request_id: 'r1', status: 'applied', outcome: 'green', checks });
  });
}

const PHONES = [
  { id: 'p1', kind: 'phone', value: '054-2244973' },
  { id: 'p2', kind: 'phone', value: '054-5990250' },
];

describe('deleting a contact in the edit dialog', () => {
  it('marks a row with the trash can, shows the check and saves a deletion', async () => {
    const spy = mockDatabase();
    await dialogWith(PHONES);
    const trash = await screen.findByRole('button', { name: 'מחיקת טלפון נייד: 054-2244973' });
    expect(trash.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(trash);
    expect(trash.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/יימחק בשמירה/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('השינויים נשמרו.')).toBeDefined();
    const change = {
      supplier_id: SUPPLIER,
      kind: 'contact',
      contact_kind: 'phone',
      contact_id: 'p1',
      value: '',
    };
    const sent = spy.mock.calls.map((call) => [call[0], call[1]]);
    expect(sent).toContainEqual(['check_supplier_change', { change }]);
    expect(sent).toContainEqual(['submit_supplier_change', { change }]);
  });

  it('takes a deletion back with a second press, so nothing is saved', async () => {
    const spy = mockDatabase();
    await dialogWith(PHONES);
    const trash = await screen.findByRole('button', { name: 'מחיקת טלפון נייד: 054-5990250' });
    await userEvent.click(trash);
    await userEvent.click(trash);
    expect(screen.queryByText(/יימחק בשמירה/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('אין שינויים לשמירה.')).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('deletion texts', () => {
  it('explains a deletion, the last of its kind and a duplicate row', () => {
    expect(checkText({ check: 'contact_removal', outcome: 'green', name: 'א' })).toBe(
      'הפרט יימחק: א.',
    );
    expect(checkText({ check: 'contact_removal', outcome: 'yellow', name: 'א' })).toMatch(
      /האחרון מסוגו/,
    );
    expect(
      checkText({ check: 'contact_rule', outcome: 'red', problem: 'duplicate_contact' }),
    ).toMatch(/מחקו את השורה הזאת בפח/);
  });

  it('lists a waiting deletion by what it deletes', () => {
    const change: ChangeRequest = {
      id: 'r1',
      supplier_id: SUPPLIER,
      change_kind: 'contact',
      contact_kind: 'phone',
      old_value: '054-5990250',
      new_value: null,
      reason: null,
      checks: [],
      created_at: '2026-11-22T10:00:00Z',
      created_by: 'u1',
    };
    render(<PendingChanges changes={[change]} userId="u2" admin={false} editor />);
    expect(screen.getByRole('heading', { name: 'מחיקת טלפון: 054-5990250' })).toBeDefined();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { compactCatalog } from '../../../data/compact-catalog.ts';
import { supplierDetail, type SupplierDetail } from '../../../data/supplier-detail.ts';
import { writableVersions, type WriteContext } from '../../../data/write-context.ts';
import * as rpc from '../../../data/rpc.ts';
import * as site from '../../../data/site.ts';
import { DataError } from '../../../data/client.ts';
import { RULE_MESSAGES } from '../../../lib/rules/messages.ts';
import {
  access,
  client,
  SUPPLIER,
  wireCatalog,
  wireDetail,
} from '../../../../tests/catalog-fixture.ts';
import { SupplierDetails } from '../components/supplier-details.tsx';
import { EditDialog } from '../components/edit-dialog.tsx';
import { AddForm } from '../components/add-form.tsx';
import styles from '../components/supplier.module.css';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function detail(audit: unknown = null): Promise<SupplierDetail> {
  const api = client(() => Response.json(wireDetail({ audit })));
  return supplierDetail(api, compactCatalog(wireCatalog()), SUPPLIER);
}

function show(element: React.ReactNode) {
  const router = createMemoryRouter([{ path: '/', element, loader: () => null }]);
  render(<RouterProvider router={router} />);
}

function mockWrites() {
  vi.spyOn(rpc, 'sessionToken').mockReturnValue('token');
  vi.spyOn(rpc, 'freshToken').mockResolvedValue('token');
  vi.spyOn(site, 'loadSnapshot').mockResolvedValue(
    {} as Awaited<ReturnType<typeof site.loadSnapshot>>,
  );
}

describe('supplier details', () => {
  it('shows invalid contacts, listing dates and source links, without history for a viewer', async () => {
    const data = await detail();
    data.memberships = data.memberships.map((m) => ({
      ...m,
      engagement_started_on: '2024-02-01',
      dates_source: 'municipal_registry',
    }));
    show(<SupplierDetails data={data} today="2026-11-17" />);
    expect(await screen.findByText('ייתכן שאינו תקין')).toBeDefined();
    expect(screen.getByText('תחילת התקשרות: 01.02.2024')).toBeDefined();
    expect(screen.queryByText(/לא תועד/)).toBeNull();
    expect(screen.getByText('bad').closest('a')).toBeNull();
    expect(screen.queryByRole('link', { name: /מסמך המאגר/ })).toBeNull();
    const links = screen.getAllByRole('link', { name: /מסמך מקור/ });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.getAttribute('href') === 'https://example.test/source')).toBe(
      true,
    );
    expect(links.every((link) => link.getAttribute('rel') === 'noopener noreferrer')).toBe(true);
    expect(screen.queryByRole('heading', { name: 'היסטוריית שינויים' })).toBeNull();
    expect(screen.getByRole('button', { name: 'ספק מאומת' })).toBeDefined();
    const band = screen.getByRole('region', { name: /^(מותר|לא מותר|לבדוק)$/ });
    expect(band.textContent).toContain('אפשר להתקשר עם הספק דרך המאגר?');
    expect(band.textContent).toContain('לא נבדק ברשמים');
  });

  it('marks a waiting supplier with a labelled clock that shows its label on focus', async () => {
    const data = await detail();
    data.supplier = { ...data.supplier, review_status: 'needs_review' };
    show(<SupplierDetails data={data} today="2026-11-17" />);
    const mark = await screen.findByRole('button', { name: 'ממתין לאימות' });
    const tip = screen.getByText('ממתין לאימות');
    expect(tip.hidden).toBe(true);
    await userEvent.tab();
    while (document.activeElement !== mark) await userEvent.tab();
    expect(tip.hidden).toBe(false);
    await userEvent.keyboard('{Escape}');
    expect(tip.hidden).toBe(true);
    // The mark sits beside the status badge, above the name (Menash, 18.11).
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain('ממתין לאימות');
    expect(
      mark.parentElement?.parentElement?.querySelector('ul[aria-label="מצב הספק"]'),
    ).not.toBeNull();
  });

  it('shows the history as sentences with field names only, when the server sends it', async () => {
    const entry = {
      id: 1,
      row_id: 'x',
      table_name: 'suppliers',
      operation: 'UPDATE',
      changes: { display_name: { old: 'ישן', new: 'חדש' } },
      created_at: '2026-11-12T12:00:00Z',
    };
    show(<SupplierDetails data={await detail([entry])} today="2026-11-17" />);
    expect(await screen.findByRole('heading', { name: 'היסטוריית שינויים' })).toBeDefined();
    expect(screen.getByText('עודכנו פרטי הספק: שם')).toBeDefined();
    expect(screen.getByText('גלוי למנהלי מערכת בלבד')).toBeDefined();
    expect(screen.queryByText(/ישן/)).toBeNull();
  });
});

async function openDialog(data: SupplierDetail, admin = false) {
  show(<EditDialog data={data} editor admin={admin} today="2026-11-17" />);
  const dialog = await waitFor(() => {
    const found = document.querySelector('dialog');
    if (!found) throw new Error('no dialog yet');
    return found;
  });
  dialog.setAttribute('open', '');
}

type Outcome = 'green' | 'yellow' | 'red';
/** The database's answers: each change kind gets the outcome given, green by default. */
function mockChanges(outcomes: Partial<Record<string, Outcome>> = {}, admin = false) {
  return vi.spyOn(rpc, 'rpc').mockImplementation((name: string, args: unknown) => {
    const { change } = args as { change: { kind: string } };
    const outcome = outcomes[change.kind] ?? 'green';
    const checks = [{ check: 'change_size', outcome }];
    if (name === 'check_supplier_change') return Promise.resolve({ outcome, checks });
    const status = outcome === 'yellow' && !admin ? 'pending' : 'applied';
    return Promise.resolve({ request_id: 'r1', status, outcome, checks });
  });
}
const calls = (spy: ReturnType<typeof mockChanges>, name: string) =>
  spy.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);

describe('supplier edit dialog', () => {
  it('saves a green contact change at once with one button', async () => {
    mockWrites();
    const spy = mockChanges();
    const data = await detail();
    data.contacts = data.contacts.map((c) => ({ ...c, status: 'current', value: 'a@b.co.il' }));
    await openDialog(data);
    const email = await screen.findByRole('textbox', { name: 'דוא״ל' });
    await userEvent.clear(email);
    await userEvent.type(email, 'office@example.co.il');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('השינויים נשמרו.')).toBeDefined();
    const change = {
      supplier_id: SUPPLIER,
      kind: 'contact',
      contact_kind: 'email',
      value: 'office@example.co.il',
      contact_id: 'contact1',
    };
    expect(calls(spy, 'check_supplier_change')).toEqual([{ change }]);
    expect(calls(spy, 'submit_supplier_change')).toEqual([{ change }]);
    expect(site.loadSnapshot).toHaveBeenCalledWith('token');
  });

  it('shows one saving state, the button, and the outcome once', async () => {
    mockWrites();
    const spy = mockChanges();
    let finish: (value: unknown) => void = () => undefined;
    spy.mockImplementation((name: string) => {
      if (name === 'check_supplier_change') {
        return Promise.resolve({
          outcome: 'green',
          checks: [{ check: 'change_size', outcome: 'green' }],
        });
      }
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const data = await detail();
    data.contacts = data.contacts.map((c) => ({ ...c, status: 'current', value: 'a@b.co.il' }));
    await openDialog(data);
    const email = await screen.findByRole('textbox', { name: 'דוא״ל' });
    await userEvent.clear(email);
    await userEvent.type(email, 'office@example.co.il');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await screen.findByRole('button', { name: 'שומר…' });
    // The live region tells a screen reader, but is not drawn as a second saving line.
    const status = screen.getByRole('status');
    expect(status.closest(`.${styles.visuallyHidden ?? 'missing'}`)).not.toBeNull();
    finish({ request_id: 'r1', status: 'applied', outcome: 'green', checks: [] });
    await screen.findByText('השינויים נשמרו.');
    expect(document.body.textContent.match(/נשמרו/gu)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'שמירה' })).toHaveLength(1);
  });

  it('shows the checks of a rename and saves it only with a reason', async () => {
    mockWrites();
    const spy = mockChanges();
    const data = await detail();
    data.contacts = [];
    await openDialog(data);
    const name = await screen.findByRole('textbox', { name: /שם הספק/ });
    await userEvent.clear(name);
    await userEvent.type(name, '  שם   חדש ');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText(/שם הספק \(שם חדש\): יישמר מיד/)).toBeDefined();
    expect(screen.getByText('שינוי כתיב קטן.')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText(/צריך לכתוב סיבה לשינוי/)).toBeDefined();
    expect(calls(spy, 'submit_supplier_change')).toEqual([]);
    await userEvent.type(screen.getByRole('textbox', { name: /סיבת השינוי/ }), 'לפי חשבונית');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('השינויים נשמרו.')).toBeDefined();
    expect(calls(spy, 'submit_supplier_change')).toEqual([
      { change: { supplier_id: SUPPLIER, kind: 'rename', value: 'שם חדש', reason: 'לפי חשבונית' } },
    ]);
    expect(calls(spy, 'check_supplier_change')).toHaveLength(1);
  });

  it('sends a yellow kind change for a decision and refuses a red one', async () => {
    mockWrites();
    const spy = mockChanges({ entity_kind: 'yellow', rename: 'red' });
    const data = await detail();
    data.contacts = [];
    await openDialog(data);
    const kind = await screen.findByRole('combobox', { name: 'סוג ישות' });
    await userEvent.selectOptions(kind, 'cooperative');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText(/סוג ישות \(אגודה שיתופית\): יישלח לאישור/)).toBeDefined();
    await userEvent.type(screen.getByRole('textbox', { name: /סיבת השינוי/ }), 'לפי תקנון');
    await userEvent.click(screen.getByRole('button', { name: 'שליחה לאישור' }));
    expect(await screen.findByText(/נשלחו לאישור/)).toBeDefined();
    await userEvent.type(await screen.findByRole('textbox', { name: /שם הספק/ }), ' כפול');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText(/לא עבר את הבדיקה ולא יישמר/)).toBeDefined();
    expect(screen.getByText(/: לא יישמר$/)).toBeDefined();
    expect(calls(spy, 'submit_supplier_change')).toHaveLength(1);
  });

  it('saves a yellow change of an admin at once', async () => {
    mockWrites();
    mockChanges({ contact: 'yellow' }, true);
    const data = await detail();
    data.contacts = [];
    await openDialog(data, true);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'פרט קשר חדש' }),
      'phone',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'ערך' }), '026291111');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText(/טלפון \(026291111\): יישמר מיד/)).toBeDefined();
    await userEvent.type(screen.getByRole('textbox', { name: /סיבת השינוי/ }), 'טלפון חדש');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('השינויים נשמרו.')).toBeDefined();
  });

  it('marks each broken rule beside its field and sends nothing', async () => {
    mockWrites();
    const spy = mockChanges();
    await openDialog(await detail());
    const name = await screen.findByRole('textbox', { name: /שם הספק/ });
    await userEvent.clear(name);
    await userEvent.type(name, '12345');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'פרט קשר חדש' }), 'phone');
    await userEvent.type(screen.getByRole('textbox', { name: 'ערך' }), 'שטויות');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect((await screen.findByRole('alert')).textContent).toBe('יש לתקן את השדות המסומנים.');
    expect(screen.getByText(/יש לכתוב מילים/)).toBeDefined();
    expect(screen.getByText(/מספר טלפון לא תקין/)).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows a refusal of the database in plain Hebrew', async () => {
    mockWrites();
    vi.spyOn(rpc, 'rpc').mockRejectedValue(new DataError(400, RULE_MESSAGES.bad_check_digit));
    const data = await detail();
    data.contacts = [];
    await openDialog(data);
    const name = await screen.findByRole('textbox', { name: /שם הספק/ });
    await userEvent.type(name, ' נוסף');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect((await screen.findByRole('alert')).textContent).toBe(RULE_MESSAGES.bad_check_digit);
  });
});

describe('supplier status', () => {
  it('asks an admin for a reason and a past date before deactivating', async () => {
    mockWrites();
    const call = vi.spyOn(rpc, 'rpc').mockResolvedValue(null);
    await openDialog(await detail(), true);
    const mark = await screen.findByRole('button', { name: 'סימון כלא פעיל' });
    expect(mark.className).toMatch(/danger/);
    await userEvent.click(mark);
    await userEvent.click(screen.getByRole('button', { name: 'אישור סימון כלא פעיל' }));
    expect(await screen.findByText(RULE_MESSAGES.required)).toBeDefined();
    expect(call).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox', { name: /סיבה/ }), 'מונתה לשופטת');
    await userEvent.click(screen.getByRole('button', { name: 'אישור סימון כלא פעיל' }));
    expect(await screen.findByText('הספק סומן כלא פעיל.')).toBeDefined();
    expect(call.mock.calls[0]?.[1]).toEqual({
      target: SUPPLIER,
      change: { active: false, reason: 'מונתה לשופטת', changedOn: '2026-11-17' },
    });
    expect(screen.getByRole('button', { name: 'סגירה' })).toBeDefined();
  });
});

describe('status panel and verification mark', () => {
  it('reactivates an inactive supplier after confirming, or cancels', async () => {
    mockWrites();
    const call = vi.spyOn(rpc, 'rpc').mockResolvedValue(null);
    const data = await detail();
    data.supplier = { ...data.supplier, status: 'inactive' };
    await openDialog(data, true);
    await userEvent.click(await screen.findByRole('button', { name: 'סימון כפעיל' }));
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('button', { name: 'אישור סימון כפעיל' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'סימון כפעיל' }));
    await userEvent.click(screen.getByRole('button', { name: 'אישור סימון כפעיל' }));
    expect(await screen.findByText('הספק סומן כפעיל.')).toBeDefined();
    expect(call.mock.calls[0]?.[1]).toEqual({ target: SUPPLIER, change: { active: true } });
  });

  it('keeps what was typed when the database refuses a status change', async () => {
    mockWrites();
    vi.spyOn(rpc, 'rpc').mockRejectedValue(new Error('נדחה.'));
    show(<EditDialog data={await detail()} editor={false} admin today="2026-11-17" />);
    const dialog = await waitFor(() => {
      const found = document.querySelector('dialog');
      if (!found) throw new Error('no dialog yet');
      return found;
    });
    dialog.setAttribute('open', '');
    await userEvent.click(await screen.findByRole('button', { name: 'סימון כלא פעיל' }));
    await userEvent.type(screen.getByRole('textbox', { name: /סיבה/ }), 'החברה פורקה');
    await userEvent.type(screen.getByRole('textbox', { name: /מקור/ }), 'רשם החברות');
    await userEvent.click(screen.getByRole('button', { name: 'אישור סימון כלא פעיל' }));
    expect((await screen.findByRole('alert')).textContent).toBe('נדחה.');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /סיבה/ }).value).toBe(
      'החברה פורקה',
    );
    expect(screen.queryByRole('textbox', { name: /שם הספק/ })).toBeNull();
  });

  it('keeps save off until something changes, and keeps typed values after a refused save', async () => {
    mockWrites();
    vi.spyOn(rpc, 'rpc').mockRejectedValue(new Error('נדחה.'));
    const data = await detail();
    data.contacts = [];
    await openDialog(data);
    const save = await screen.findByRole<HTMLButtonElement>('button', { name: 'שמירה' });
    expect(save.disabled).toBe(true);
    const name = screen.getByRole<HTMLInputElement>('textbox', { name: /שם הספק/ });
    await userEvent.type(name, ' נוסף');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect((await screen.findByRole('alert')).textContent).toBe('נדחה.');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /שם הספק/ }).value).toMatch(
      /נוסף$/,
    );
  });

  it('shows the mark label on hover and on tap', async () => {
    show(<SupplierDetails data={await detail()} today="2026-11-17" />);
    const mark = await screen.findByRole('button', { name: 'ספק מאומת' });
    const tip = screen.getByText('ספק מאומת');
    await userEvent.hover(mark);
    expect(tip.hidden).toBe(false);
    await userEvent.unhover(mark);
    expect(tip.hidden).toBe(true);
    await userEvent.click(mark);
    expect(tip.hidden).toBe(false);
  });
});

describe('adding a supplier', () => {
  function context(): WriteContext {
    const catalog = compactCatalog(wireCatalog());
    const editor = access({ editor: true, grants: [{ role: 'editor', unitId: 'u1' }] });
    return { catalog, identifiers: [], versions: writableVersions(catalog, editor) };
  }

  it('offers a similar supplier and saves the membership on the one chosen', async () => {
    mockWrites();
    const save = vi.spyOn(site, 'saveMembership').mockResolvedValue('ok');
    show(<AddForm context={context()} />);
    await userEvent.type(await screen.findByRole('textbox', { name: /שם הספק/ }), 'שם נוכחי');
    const similar = screen.getByRole('radio', { name: /^שם נוכחי/u });
    expect(similar.closest('label')?.textContent).toMatch(/מאגר א/u);
    await userEvent.click(similar);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /מאגר וגרסה/ }), 'v1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /תחום/ }), 'f1');
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הספק' }));
    expect(await screen.findByText('הספק נוסף וממתין לאימות של משתמש אחר.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'לכרטיס הספק' }).getAttribute('href')).toBe(
      '/supplier/ok',
    );
    const payload = save.mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      display_name: 'שם נוכחי',
      supplier_id: SUPPLIER,
      registry_version_id: 'v1',
      registry_field_id: 'f1',
    });
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: /שם הספק/ }).value).toBe('');
    });
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows one saving indicator, the button, while the supplier is saved', async () => {
    mockWrites();
    let finish: (id: string) => void = () => undefined;
    vi.spyOn(site, 'saveMembership').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    show(<AddForm context={context()} />);
    await userEvent.type(await screen.findByRole('textbox', { name: /שם הספק/ }), 'ספק חדש');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /מאגר וגרסה/ }), 'v1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /תחום/ }), 'f1');
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הספק' }));
    const button = await screen.findByRole('button', { name: 'שומר…' });
    // The live region still tells a screen reader, but is not drawn as a second "שומר…".
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('שומר…');
    expect(status.closest(`.${styles.visuallyHidden ?? 'missing'}`)).not.toBeNull();
    expect(button.closest(`.${styles.visuallyHidden ?? 'missing'}`)).toBeNull();
    finish('ok');
    expect(await screen.findByText('הספק נוסף וממתין לאימות של משתמש אחר.')).toBeDefined();
  });

  it('offers only the pools the editor may write to', async () => {
    show(<AddForm context={context()} />);
    const pool = await screen.findByRole('combobox', { name: /מאגר וגרסה/ });
    expect([...(pool as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'v1']);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: /תחום/ }).disabled).toBe(true);
  });
});

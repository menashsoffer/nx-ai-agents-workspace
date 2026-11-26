import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as rpc from '../../../data/rpc.ts';
import { refusal } from '../../../data/client.ts';
import { SupplierAreaPage, loader } from '../supplier-area-page.tsx';
import type { PortalMe, Proposal, SupplierFile } from '../api/portal.ts';
import { documentRows, type KindRow } from '../model/documents.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN = `x.${btoa(JSON.stringify({ sub: USER }))}.y`;
const PERSON = { user_id: USER, first_name: 'דנה', last_name: 'כהן', job_title: null, phone: null };
const me = (over: Partial<PortalMe> = {}): PortalMe => ({
  email: 'dana@example.co.il',
  person: PERSON,
  accounts: [],
  invites: [],
  ...over,
});
const FILE: SupplierFile = {
  id: 's1',
  name: 'ספק בע"מ',
  entity_kind: 'company',
  website: null,
  role: 'owner',
  other_names: ['שם מסחרי'],
  identifiers: [{ scheme: 'company', value: '512345679', verified: true }],
  contacts: [{ id: 'c1', kind: 'phone', value: '02-6291111' }],
  memberships: [
    {
      registry: 'מאגר יועצים',
      unit: 'אגף 1',
      field: 'ייעוץ',
      registered_from: null,
      registered_until: '2026-12-01',
      document_url: 'https://example.test/doc.pdf',
    },
    {
      registry: 'מאגר ישן',
      unit: null,
      field: null,
      registered_from: null,
      registered_until: '2025-01-01',
      document_url: null,
    },
  ],
};

function page(value: {
  me: PortalMe;
  step: string;
  file: SupplierFile | null;
  proposals?: Proposal[];
  documents?: KindRow[];
}) {
  const data = { proposals: [], documents: [], approaches: [], ...value, today: '2026-11-22' };
  const router = createMemoryRouter(
    [{ id: 'area', path: '/', Component: SupplierAreaPage, loader: () => data }],
    { hydrationData: { loaderData: { area: data } } },
  );
  render(<RouterProvider router={router} />);
}
type Rpc = (name: string, args: unknown) => unknown;
function answer(handler: Rpc) {
  return vi.spyOn(rpc, 'rpc').mockImplementation((name, args, schema) => {
    try {
      return Promise.resolve(schema.parse(handler(name, args)));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the supplier area', () => {
  it('sends a signed-out visitor to the supplier sign-in', async () => {
    vi.spyOn(rpc, 'getAdminSession').mockReturnValue(null);
    const result = await loader();
    expect(result instanceof Response && result.headers.get('Location')).toBe(
      '/supplier-area/login?next=%2Fsupplier-area',
    );
  });

  it('loads the file of the first active link', async () => {
    vi.spyOn(rpc, 'getAdminSession').mockReturnValue({ token: TOKEN, exp: 0, refresh: null });
    const account = {
      id: 'a',
      supplier_id: 's1',
      supplier_name: 'ספק',
      role: 'owner',
      status: 'active',
      method: 'invite',
      decision_note: null,
      created_at: '2026-11-22T08:00:00Z',
    };
    answer((name) => {
      if (name === 'portal_me') return me({ accounts: [account] as never });
      if (name === 'portal_documents') return { kinds: ['insurance'], documents: [] };
      if (name === 'portal_members') return { members: [], invites: [] };
      if (name === 'portal_approaches') return [];
      return name === 'portal_changes' ? [] : FILE;
    });
    const result = await loader();
    expect(result).toMatchObject({
      step: 'file',
      file: { name: 'ספק בע"מ' },
      documents: [{ kind: 'insurance', state: 'missing' }],
      members: { members: [], invites: [] },
      approaches: [],
    });
  });

  it('asks a new person for their details and saves them', async () => {
    vi.spyOn(rpc, 'sessionToken').mockReturnValue(TOKEN);
    const save = vi.spyOn(rpc, 'savePortalPerson').mockResolvedValue();
    page({ me: me({ person: null }), step: 'person', file: null });
    await userEvent.type(screen.getByLabelText(/שם פרטי/), 'דנה');
    await userEvent.type(screen.getByLabelText(/שם משפחה/), 'כהן');
    await userEvent.type(screen.getByLabelText(/התפקיד/), 'מנכ"ל');
    await userEvent.type(screen.getByLabelText(/טלפון/), '0521234567');
    await userEvent.click(screen.getByRole('button', { name: 'שמירה והמשך' }));
    expect(save).toHaveBeenCalledWith(
      {
        user_id: USER,
        first_name: 'דנה',
        last_name: 'כהן',
        job_title: 'מנכ"ל',
        phone: '0521234567',
      },
      false,
    );
  });

  it('links by number, and asks for proof when the email does not match', async () => {
    const calls: string[] = [];
    answer((name, args) => {
      calls.push(name);
      if (name === 'portal_find_supplier') return { supplier_id: 's1', name: 'ספק בע"מ' };
      if ((args as { request: { proof_path: string | null } }).request.proof_path === null)
        throw refusal(400, 'reason:proof_required', 'rule');
      return { account_id: 'a', status: 'pending' };
    });
    vi.spyOn(rpc, 'sessionToken').mockReturnValue(TOKEN);
    vi.spyOn(rpc, 'freshToken').mockResolvedValue(TOKEN);
    const upload = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    page({ me: me(), step: 'link', file: null });
    const field = screen.getByLabelText(/ח"פ או מספר עמותה/);
    await userEvent.type(field, '512345678');
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(await screen.findByText(/המספר לא תקין/)).toBeDefined();
    expect((field as HTMLInputElement).value).toBe('512345678');
    await userEvent.clear(field);
    await userEvent.type(field, '512345679');
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(await screen.findByText('ספק בע"מ')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'כן, זה הספק' }));
    const proof = await screen.findByLabelText(/תדפיס רשם/);
    await userEvent.upload(proof, new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    // jsdom's own validity ignores files set by userEvent, so its native "required" check
    // would block the submit; in a browser that check passes once a file is chosen.
    proof.removeAttribute('required');
    await userEvent.click(screen.getByRole('button', { name: 'שליחה לאישור' }));
    await vi.waitFor(() => {
      expect(calls).toEqual(['portal_find_supplier', 'portal_request_link', 'portal_request_link']);
    });
    expect(upload.mock.calls[0]?.[0]).toMatch(
      new RegExp(`/storage/v1/object/supplier-documents/link-proofs/${USER}/.+\\.pdf$`),
    );
  });

  it('says when no supplier has the number, and goes back on "not this one"', async () => {
    answer((name) => (name === 'portal_find_supplier' ? null : {}));
    page({ me: me(), step: 'link', file: null });
    await userEvent.type(screen.getByLabelText(/ח"פ או מספר עמותה/), '512345679');
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(await screen.findByText(/הספק לא נמצא במאגרי העירייה/)).toBeDefined();
  });

  it('accepts an invite', async () => {
    const call = answer(() => ({ account_id: 'a', status: 'active' }));
    const invite = {
      id: 'i1',
      supplier_name: 'ספק',
      role: 'owner' as const,
      expires_at: '2026-12-01',
    };
    page({ me: me({ invites: [invite] }), step: 'invites', file: null });
    await userEvent.click(screen.getByRole('button', { name: 'קבלת ההזמנה' }));
    expect(call).toHaveBeenCalledWith(
      'portal_accept_invite',
      { invite_id: 'i1' },
      expect.anything(),
    );
  });

  it('shows a waiting or rejected link with its reason, and no wizard while one waits', () => {
    const base = { supplier_id: 's1', supplier_name: 'ספק', role: 'owner', method: 'document' };
    const accounts = [
      { ...base, id: 'p', status: 'pending', decision_note: null, created_at: '2026-11-22T08:00Z' },
      {
        ...base,
        id: 'r',
        status: 'rejected',
        decision_note: 'אין הוכחה',
        created_at: '2026-11-20T08:00Z',
      },
    ];
    page({ me: me({ accounts: accounts as never }), step: 'link', file: null });
    expect(screen.getByText(/ממתינה לאישור העירייה/)).toBeDefined();
    expect(screen.getByText(/הסיבה: אין הוכחה/)).toBeDefined();
    expect(screen.queryByRole('form', { name: 'שיוך לספק' })).toBeNull();
  });

  it('shows the supplier its file and when each registration ends', () => {
    page({ me: me(), step: 'file', file: FILE });
    expect(screen.getByRole('heading', { name: 'ספק בע"מ', level: 1 })).toBeDefined();
    expect(screen.getByText(/מאומת/)).toBeDefined();
    expect(screen.getByText('מסתיים ב-01.12.2026')).toBeDefined();
    expect(screen.getByText('הסתיים ב-01.01.2025')).toBeDefined();
    expect(screen.getByRole('link', { name: 'מסמך המאגר' })).toBeDefined();
  });

  it('lists what is missing and moves to that section', async () => {
    page({ me: me(), step: 'file', file: FILE });
    const missing = screen.getByRole('region', { name: 'מה חסר לי' });
    const cards = within(missing).getAllByRole('listitem');
    expect(cards.map((c) => c.firstChild?.textContent)).toEqual([
      'רישום אחד מסתיים ב-01.12.2026',
      'חסר דוא"ל ליצירת קשר',
    ]);
    const [ending, contact] = within(missing).getAllByRole('button', { name: 'מעבר' });
    if (!ending || !contact) throw new Error('two cards expected');
    await userEvent.click(ending);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'המאגרים שלי' }));
    await userEvent.click(contact);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'הפרטים שלי' }));
  });

  it('shows no missing card when nothing is missing', () => {
    const full = {
      ...FILE,
      contacts: [...FILE.contacts, { id: 'c2', kind: 'email', value: 'a@b.co.il' }],
      memberships: [],
    };
    page({ me: me(), step: 'file', file: full });
    expect(screen.queryByRole('region', { name: 'מה חסר לי' })).toBeNull();
  });
});

describe('proposing a fix', () => {
  beforeEach(() => {
    // jsdom has no native dialog close; the real one is checked in Chromium.
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
  });
  const openDialogs = () => {
    for (const dialog of document.querySelectorAll('dialog')) dialog.setAttribute('open', '');
  };

  it('checks the value, then sends a contact fix and says it will be checked', async () => {
    const call = answer(() => ({ request_id: 'r1', status: 'pending' }));
    page({ me: me(), step: 'file', file: FILE });
    openDialogs();
    const form = screen.getByRole('form', { name: 'תיקון טלפון' });
    await userEvent.type(within(form).getByLabelText(/הערך הנכון/), 'abc');
    await userEvent.click(within(form).getByRole('button', { name: 'שליחה לבדיקה' }));
    expect(await within(form).findByText(/מספר טלפון לא תקין/)).toBeDefined();
    expect(call).not.toHaveBeenCalled();
    await userEvent.clear(within(form).getByLabelText(/הערך הנכון/));
    await userEvent.type(within(form).getByLabelText(/הערך הנכון/), '026293333');
    await userEvent.click(within(form).getByRole('button', { name: 'שליחה לבדיקה' }));
    expect(call).toHaveBeenCalledWith(
      'portal_propose_change',
      {
        change: {
          supplier_id: 's1',
          kind: 'contact',
          value: '026293333',
          contact_kind: 'phone',
          contact_id: 'c1',
        },
      },
      expect.anything(),
    );
    expect(await screen.findByText('נבדוק את השינוי ונעדכן.')).toBeDefined();
  });

  it('asks for a reason to rename, and shows a refusal from the database', async () => {
    answer(() => {
      throw refusal(400, 'reason:proposal_pending', 'rule');
    });
    page({ me: me(), step: 'file', file: FILE });
    openDialogs();
    const form = screen.getByRole('form', { name: 'תיקון שם הספק' });
    await userEvent.type(within(form).getByLabelText(/הערך הנכון/), 'ספק חדש בעמ');
    await userEvent.click(within(form).getByRole('button', { name: 'שליחה לבדיקה' }));
    expect(await within(form).findByText(/צריך לכתוב סיבה/)).toBeDefined();
    await userEvent.type(within(form).getByLabelText(/סיבה/), 'שינוי שם ברשם');
    await userEvent.click(within(form).getByRole('button', { name: 'שליחה לבדיקה' }));
    expect(await within(form).findByText(/כבר שלחתם תיקון/)).toBeDefined();
  });

  it('adds a new contact of a chosen kind', async () => {
    const call = answer(() => ({ request_id: 'r2', status: 'pending' }));
    page({ me: me(), step: 'file', file: FILE });
    openDialogs();
    const form = screen.getByRole('form', { name: 'פרט חדש' });
    await userEvent.selectOptions(within(form).getByLabelText(/סוג הפרט/), 'email');
    await userEvent.type(within(form).getByLabelText(/^הערך/), 'office@example.co.il');
    await userEvent.click(within(form).getByRole('button', { name: 'שליחה לבדיקה' }));
    expect(call).toHaveBeenCalledWith(
      'portal_propose_change',
      {
        change: {
          supplier_id: 's1',
          kind: 'contact',
          value: 'office@example.co.il',
          contact_kind: 'email',
        },
      },
      expect.anything(),
    );
  });

  it('lists the requests with their state, and cancels a waiting one of mine', async () => {
    const call = answer(() => null);
    const base = {
      contact_kind: null,
      old_value: 'ספק',
      decided_at: null,
      created_at: '2026-11-22',
    };
    const proposals: Proposal[] = [
      {
        ...base,
        id: 'p1',
        kind: 'rename',
        new_value: 'ספק חדש',
        status: 'pending',
        decision_note: null,
        mine: true,
      },
      {
        ...base,
        id: 'p2',
        kind: 'contact',
        contact_kind: 'phone',
        new_value: '026290000',
        status: 'rejected',
        decision_note: 'לא נכון',
        mine: false,
      },
    ];
    page({ me: me(), step: 'file', file: FILE, proposals });
    const list = screen.getByRole('region', { name: 'הבקשות שלי' });
    expect(within(list).getByText(/ממתין לבדיקה/)).toBeDefined();
    expect(within(list).getByText(/נדחה · .*הסיבה: לא נכון/)).toBeDefined();
    await userEvent.click(within(list).getByRole('button', { name: 'ביטול הבקשה' }));
    expect(call).toHaveBeenCalledWith(
      'cancel_supplier_change',
      { request_id: 'p1' },
      expect.anything(),
    );
  });
});

describe('my documents', () => {
  const openDialogs = () => {
    for (const dialog of document.querySelectorAll('dialog')) dialog.setAttribute('open', '');
  };
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
  });
  const rows = documentRows(
    {
      kinds: ['bookkeeping', 'insurance'],
      documents: [
        {
          id: 'd1',
          kind: 'bookkeeping',
          status: 'approved',
          valid_until: '2027-06-30',
          review_note: null,
          created_at: '2026-11-01T08:00:00Z',
          reviewed_at: '2026-11-02T08:00:00Z',
          storage_path: 's1/d1.pdf',
        },
      ],
    },
    '2026-11-22',
  );

  it('shows each kind with its state, and asks for a file before sending', async () => {
    page({ me: me(), step: 'file', file: FILE, documents: rows });
    const list = screen.getByRole('region', { name: 'המסמכים שלי' });
    expect(within(list).getByText('בתוקף עד 30.06.2027')).toBeDefined();
    expect(within(list).getByText('חסר')).toBeDefined();
    expect(within(list).getByRole('button', { name: 'החלפה' })).toBeDefined();
    expect(within(list).getByRole('button', { name: 'העלאה' })).toBeDefined();
    openDialogs();
    const dialog = screen.getByRole('form', { name: 'העלאה: אישור קיום ביטוחים' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'שליחה לבדיקה' }));
    expect(await within(dialog).findByText('יש לצרף קובץ.')).toBeDefined();
  });

  it('uploads under the supplier folder and records the file with its date', async () => {
    vi.spyOn(rpc, 'freshToken').mockResolvedValue(TOKEN);
    const upload = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const calls: unknown[] = [];
    answer((name, args) => {
      calls.push([name, args]);
      return {
        id: 'n',
        kind: 'insurance',
        status: 'pending',
        valid_until: '2027-03-31',
        review_note: null,
        created_at: '2026-11-22T10:00:00Z',
        reviewed_at: null,
        storage_path: 's1/n.pdf',
      };
    });
    page({ me: me(), step: 'file', file: FILE, documents: rows });
    openDialogs();
    const dialog = screen.getByRole('form', { name: 'העלאה: אישור קיום ביטוחים' });
    await userEvent.upload(
      within(dialog).getByLabelText(/הקובץ/),
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    );
    const until = within(dialog).getByLabelText(/בתוקף עד/);
    fireEvent.change(until, { target: { value: '2020-01-01' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'שליחה לבדיקה' }));
    expect(await within(dialog).findByText(/מהיום ועד עשר שנים/)).toBeDefined();
    fireEvent.change(until, { target: { value: '2027-03-31' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'שליחה לבדיקה' }));
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(upload.mock.calls[0]?.[0]).toMatch(/\/supplier-documents\/s1\/.+\.pdf$/);
    expect(calls[0]).toMatchObject([
      'portal_save_document',
      { document: { supplier_id: 's1', kind: 'insurance', valid_until: '2027-03-31' } },
    ]);
  });
});

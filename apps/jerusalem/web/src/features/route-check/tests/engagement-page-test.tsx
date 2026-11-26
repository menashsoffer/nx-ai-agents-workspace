import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { EngagementPage } from '../engagement-page.tsx';
import * as check from '../api/check.ts';
import { DataError } from '../../../data/client.ts';
import { RULE_MESSAGES } from '../../../lib/rules/messages.ts';
import * as engagement from '../api/engagement.ts';
import type { CheckResult } from '../model/result.ts';
import type { loader } from '../engagement-page.tsx';
import * as savedApi from '../api/saved.ts';
import * as approachesApi from '../api/approaches.ts';
import type { SavedRequest } from '../api/saved.ts';
import * as rpc from '../../../data/rpc.ts';
import { replaceShortlist, shortlistIds } from '../../../lib/shortlist.ts';
type PageData = Awaited<ReturnType<typeof loader>>;

const REQUEST = '50000000-0000-4000-8000-000000000001';
const result: CheckResult = {
  id: null,
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
  emails: ['a@x.test'],
  phones: [],
  lastApproached: '2026-10-01',
};

function savedRow(): SavedRequest {
  return {
    id: REQUEST,
    unit_id: 'u1',
    subject: 'ייעוץ ארגוני',
    estimated_value: 90000,
    value_includes_vat: true,
    requested_exemption: null,
    status: 'draft',
    created_at: '2026-11-10T08:00:00Z',
    updated_at: '2026-11-10T08:00:00Z',
    lastStatus: 'blocked',
    changedSinceCheck: false,
  };
}

function page(units: PageData['units'], more: Partial<PageData> = {}) {
  const value: PageData = {
    suppliers: [supplier],
    units,
    today: '2026-11-17',
    saved: null,
    ...more,
  };
  const router = createMemoryRouter(
    [{ id: 'engagement', path: '/', Component: EngagementPage, loader: () => value }],
    { hydrationData: { loaderData: { engagement: value } } },
  );
  render(<RouterProvider router={router} />);
}
async function fill() {
  await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
  // The wizard moves focus to the step heading on the next frame; typing before that frame
  // sends the keys to the heading on a slow machine, leaving the estimate empty.
  await vi.waitFor(() => {
    expect(document.activeElement?.textContent).toBe('פרטי הבקשה');
  });
  await userEvent.type(screen.getByLabelText(/^אומדן בש״ח/u), '120000');
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // The request details are kept for the tab; each test starts a fresh tab.
  sessionStorage.clear();
});

describe('engagement request page', () => {
  it('checks a draft without saving when the user has no unit to save in', async () => {
    page([]);
    const run = vi.spyOn(check, 'checkRoute').mockResolvedValue(result);
    const save = vi.spyOn(engagement, 'saveRequest');
    expect(screen.getByText(/פנייה אחרונה: 01.10.2026/u)).toBeDefined();
    await fill();
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'בדיקת מסלול בלבד' }));
    expect(await screen.findByRole('heading', { name: 'תוצאה' })).toBeDefined();
    expect(await screen.findByText('8(ד)(1)')).toBeDefined();
    expect(run).toHaveBeenCalledWith({
      draft: { estimated_value: 120000, value_includes_vat: false, requested_exemption: null },
      on: '2026-11-17',
    });
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /רישום פנייה/u })).toBeNull();
  });

  it('saves the request, checks it by id and then records the approach', async () => {
    replaceShortlist([supplier.id]);
    page([{ id: 'u1', name: 'אגף 1' }]);
    vi.spyOn(engagement, 'saveRequest').mockResolvedValue(REQUEST);
    const run = vi.spyOn(check, 'checkRoute').mockResolvedValue({ ...result, id: 9 });
    const record = vi.spyOn(engagement, 'recordApproaches').mockResolvedValue(1);
    await fill();
    await userEvent.type(screen.getByLabelText(/^נושא/u), 'ייעוץ ארגוני');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^יחידה/u }), 'u1');
    expect(screen.getByLabelText<HTMLInputElement>(/^נושא/u).required).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'בדיקת מסלול ושמירה ביחידה' }));
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalled();
    });
    expect(run).toHaveBeenCalledWith({ request_id: REQUEST, on: '2026-11-17' });
    // The catalog tray closes: the picked suppliers now belong to the saved request.
    expect(shortlistIds()).toEqual([]);
    await screen.findByRole('button', { name: 'רישום פנייה לספקים' });
    // jsdom has no dialog commands: open the dialog the button opens.
    const dialog = document.getElementById('approach-suppliers');
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('approach dialog expected');
    dialog.setAttribute('open', '');
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
      },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'רישום הפנייה' }));
    expect(record).toHaveBeenCalledWith({
      request: REQUEST,
      suppliers: [supplier.id],
      channel: 'email',
      respondBy: '2026-11-24',
    });
    expect(await screen.findByText(/נרשמו 1 פניות, עם מועד לתשובה 24\.11\.2026/u)).toBeDefined();
  });

  // 18.11.2026: a saved request reached "בקשות שמורות" only after a page refresh.
  it('shows a saved request in the saved list at once and keeps the result open', async () => {
    replaceShortlist([supplier.id]);
    page([{ id: 'u1', name: 'אגף 1' }], { saved: [] });
    const row: SavedRequest = {
      id: REQUEST,
      unit_id: 'u1',
      subject: 'ייעוץ ארגוני',
      estimated_value: 120000,
      value_includes_vat: false,
      requested_exemption: null,
      status: 'draft',
      created_at: '2026-11-18T10:00:00Z',
      updated_at: '2026-11-18T10:00:00Z',
      lastStatus: 'needs_review',
      changedSinceCheck: false,
    };
    const who: rpc.Identity = {
      userId: 'me',
      access: {
        state: 'active',
        member: true,
        admin: false,
        editor: true,
        manager: false,
        grants: [{ role: 'editor', unitId: 'u1' }],
      },
    };
    vi.spyOn(rpc, 'identity').mockResolvedValue(who);
    const reload = vi.spyOn(savedApi, 'loadSaved').mockResolvedValue([row]);
    // The real save runs, so the test proves that the save itself marks the list changed.
    const create = vi.spyOn(rpc, 'rpc').mockResolvedValue(REQUEST);
    vi.spyOn(check, 'checkRoute').mockResolvedValue({ ...result, id: 9 });
    expect(screen.getByRole('heading', { name: 'אין בקשות שמורות' })).toBeDefined();
    await fill();
    await userEvent.type(screen.getByLabelText(/^נושא/u), 'ייעוץ ארגוני');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^יחידה/u }), 'u1');
    await userEvent.click(screen.getByRole('button', { name: 'בדיקת מסלול ושמירה ביחידה' }));
    const table = await screen.findByRole('table', { name: 'בקשות שמורות ביחידות שלך' });
    expect(within(table).getByText('ייעוץ ארגוני')).toBeDefined();
    expect(reload).toHaveBeenCalledWith(who);
    expect(create.mock.calls[0]?.[0]).toBe('create_engagement_request');
    // The shortlist is empty now, yet the new request's result stays on screen.
    expect(screen.getByRole('heading', { name: 'תוצאה' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'רישום פנייה לספקים' })).toBeDefined();
  });

  // The 18.11.2026 incident: the request was saved, the check failed, and pressing the button
  // again saved a second copy. Now the form says what was saved and only checks it again.
  it('says the request was saved when its check fails, and checks it again without saving', async () => {
    page([{ id: 'u1', name: 'אגף 1' }]);
    const save = vi.spyOn(engagement, 'saveRequest').mockResolvedValue(REQUEST);
    const run = vi
      .spyOn(check, 'checkRoute')
      .mockRejectedValueOnce(new DataError(500))
      .mockResolvedValueOnce({ ...result, id: 9 });
    await fill();
    await userEvent.type(screen.getByLabelText(/^נושא/u), 'עבודה בפנים');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^יחידה/u }), 'u1');
    await userEvent.click(screen.getByRole('button', { name: 'בדיקת מסלול ושמירה ביחידה' }));
    expect(await screen.findByText('הבקשה נשמרה, אבל הבדיקה נכשלה.')).toBeDefined();
    expect(screen.getByText(/תקלה במערכת/u)).toBeDefined();
    expect(screen.queryByText(/יש לנסות שוב/u)).toBeNull();
    const update = vi.spyOn(savedApi, 'updateRequest');
    await userEvent.click(screen.getByRole('button', { name: 'שמירת השינויים ובדיקה חוזרת' }));
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(2);
    });
    expect(save).toHaveBeenCalledTimes(1);
    // Nothing changed, so nothing is written before the second check.
    expect(update).not.toHaveBeenCalled();
    expect(run).toHaveBeenLastCalledWith({ request_id: REQUEST, on: '2026-11-17' });
    expect(await screen.findByRole('button', { name: 'רישום פנייה לספקים' })).toBeDefined();
  });

  // 18.11.2026: "חזרה לפרטי הבקשה" opened an empty form, and saving it again made a copy.
  it('returns to the saved details, edits them in place and checks the request again', async () => {
    page([{ id: 'u1', name: 'אגף 1' }]);
    const save = vi.spyOn(engagement, 'saveRequest').mockResolvedValue(REQUEST);
    const run = vi.spyOn(check, 'checkRoute').mockResolvedValue({ ...result, id: 9 });
    const update = vi.spyOn(savedApi, 'updateRequest').mockResolvedValue();
    await fill();
    await userEvent.type(screen.getByLabelText(/^נושא/u), 'ייעוץ ארגוני');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^יחידה/u }), 'u1');
    await userEvent.click(screen.getByRole('button', { name: 'בדיקת מסלול ושמירה ביחידה' }));
    await userEvent.click(await screen.findByRole('button', { name: 'חזרה לפרטי הבקשה' }));
    // Focus moves to the step heading on the next frame; typing before it loses keys.
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toBe('פרטי הבקשה');
    });
    const value = screen.getByLabelText<HTMLInputElement>(/^אומדן בש״ח/u);
    expect(value.value).toBe('120000');
    expect(screen.getByLabelText<HTMLInputElement>(/^נושא/u).value).toBe('ייעוץ ארגוני');
    const unit = screen.getByRole<HTMLSelectElement>('combobox', { name: /^יחידה/u });
    expect([unit.value, unit.disabled]).toEqual(['u1', true]);
    await userEvent.clear(value);
    await userEvent.type(value, '90000');
    await userEvent.click(screen.getByRole('button', { name: 'שמירת השינויים ובדיקה חוזרת' }));
    expect(await screen.findByRole('heading', { name: 'תוצאה' })).toBeDefined();
    expect(update).toHaveBeenCalledWith(REQUEST, {
      subject: 'ייעוץ ארגוני',
      estimated_value: 90000,
      value_includes_vat: false,
      requested_exemption: null,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith({ request_id: REQUEST, on: '2026-11-17' });
  });

  it('keeps typed details when going back to the suppliers and forward again', async () => {
    page([]);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'לשלב הקודם' }));
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(screen.getByLabelText<HTMLInputElement>(/^אומדן בש״ח/u).value).toBe('120000');
  });

  it('reports a refused clipboard instead of claiming a copy', async () => {
    page([]);
    vi.spyOn(check, 'checkRoute').mockResolvedValue(result);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'בדיקת מסלול בלבד' }));
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(await screen.findByRole('button', { name: 'העתקת כתובות ל-BCC' }));
    expect(await screen.findByText('ההעתקה נכשלה.')).toBeDefined();
    expect(writeText).toHaveBeenCalledWith('a@x.test');
  });

  it('goes back a step and keeps the suppliers list', async () => {
    page([]);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'לשלב הקודם' }));
    expect(screen.getByRole('heading', { name: 'הספקים' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'להמשך איתור ספקים' }).getAttribute('href')).toBe(
      '/catalog',
    );
  });

  it('opens a step from its pill and keeps the result closed until a check ran', async () => {
    page([]);
    vi.spyOn(check, 'checkRoute').mockResolvedValue(result);
    const pill = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
    expect(pill('הספקים').getAttribute('aria-current')).toBe('step');
    expect(pill('תוצאה').disabled).toBe(true);
    await userEvent.click(pill('פרטי הבקשה'));
    // Focus moves from the pill to the step heading on the next frame; wait before typing.
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'פרטי הבקשה' }));
    });
    expect(pill('פרטי הבקשה').getAttribute('aria-current')).toBe('step');
    await userEvent.type(screen.getByLabelText(/^אומדן בש״ח/u), '120000');
    await userEvent.click(screen.getByRole('button', { name: 'בדיקת מסלול בלבד' }));
    await screen.findByRole('heading', { name: 'תוצאה' });
    await userEvent.click(pill('הספקים'));
    expect(screen.getByRole('heading', { name: 'הספקים' })).toBeDefined();
    expect(pill('תוצאה').disabled).toBe(false);
    await userEvent.click(pill('תוצאה'));
    expect(screen.getByRole('heading', { name: 'תוצאה' })).toBeDefined();
  });

  it('points to the catalog when no supplier is picked', () => {
    page([], { suppliers: [] });
    expect(screen.getByRole('heading', { name: 'לא נבחרו ספקים לבקשה חדשה' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'בקשות שמורות' })).toBeNull();
  });

  it('lists saved requests and checks one again on another date', async () => {
    const saved: SavedRequest = {
      id: REQUEST,
      unit_id: 'u1',
      subject: 'ייעוץ ארגוני',
      estimated_value: 90000,
      value_includes_vat: true,
      requested_exemption: null,
      status: 'draft',
      created_at: '2026-11-10T08:00:00Z',
      updated_at: '2026-11-10T08:00:00Z',
      lastStatus: 'blocked',
      changedSinceCheck: false,
    };
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    const run = vi.spyOn(check, 'checkRoute').mockResolvedValue(result);
    page([], { saved: [saved] });
    const table = screen.getByRole('table', { name: 'בקשות שמורות ביחידות שלך' });
    expect(table.textContent).toMatch(/10\.11\.2026/u);
    expect(table.textContent).toMatch(/המסלול חסום/u);
    await userEvent.click(screen.getByRole('button', { name: 'בדיקה מחדש: ייעוץ ארגוני' }));
    const date = screen.getByLabelText<HTMLInputElement>(/^תאריך לבדיקה/u);
    await userEvent.clear(date);
    await userEvent.type(date, '2026-12-01');
    await userEvent.click(screen.getByRole('button', { name: 'בדיקת המסלול' }));
    expect(run).toHaveBeenCalledWith({ request_id: REQUEST, on: '2026-12-01' });
    expect(await screen.findByText('8(ד)(1)')).toBeDefined();
  });
  it('shows the approaches and answers of a saved request', async () => {
    const load = vi.spyOn(approachesApi, 'loadRequestApproaches').mockResolvedValue([]);
    page([{ id: 'u1', name: 'אגף 1' }], { saved: [savedRow()] });
    await userEvent.click(screen.getByRole('button', { name: 'פניות ותשובות: ייעוץ ארגוני' }));
    expect(await screen.findByText('עוד לא נרשמו פניות')).toBeDefined();
    expect(load).toHaveBeenCalledWith(REQUEST);
  });

  // 18.11.2026: the owner asked to edit a saved request in the details form, not a dialog.
  it('edits a saved request in the details form and checks it again', async () => {
    const row = savedRow();
    page([{ id: 'u1', name: 'אגף 1' }], { saved: [row] });
    const update = vi.spyOn(savedApi, 'updateRequest').mockResolvedValue();
    const run = vi.spyOn(check, 'checkRoute').mockResolvedValue({ ...result, id: 9 });
    await userEvent.click(screen.getByRole('button', { name: 'עריכת הבקשה: ייעוץ ארגוני' }));
    const heading = screen.getByRole('heading', { name: 'עריכת הבקשה: ייעוץ ארגוני' });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    const editor = within(screen.getByRole('region', { name: 'עריכת הבקשה: ייעוץ ארגוני' }));
    const value = editor.getByLabelText<HTMLInputElement>(/^אומדן בש״ח/u);
    expect(value.value).toBe('90000');
    expect(editor.getByLabelText<HTMLInputElement>(/^האומדן כולל/u).checked).toBe(true);
    await userEvent.clear(value);
    await userEvent.type(value, '75,000');
    await userEvent.click(editor.getByRole('button', { name: 'שמירת השינויים ובדיקה חוזרת' }));
    expect(await editor.findByText('8(ד)(1)')).toBeDefined();
    expect(update).toHaveBeenCalledWith(REQUEST, {
      subject: 'ייעוץ ארגוני',
      estimated_value: 75000,
      value_includes_vat: true,
      requested_exemption: null,
    });
    expect(run).toHaveBeenCalledWith({ request_id: REQUEST, on: '2026-11-17' });
    await userEvent.click(editor.getByRole('button', { name: 'סגירת העריכה' }));
    expect(screen.queryByRole('heading', { name: /^עריכת הבקשה/u })).toBeNull();
  });

  it('shows why the database refused an edit and checks nothing', async () => {
    page([{ id: 'u1', name: 'אגף 1' }], { saved: [savedRow()] });
    const refused = new DataError(400, RULE_MESSAGES.request_closed);
    vi.spyOn(savedApi, 'updateRequest').mockRejectedValue(refused);
    const run = vi.spyOn(check, 'checkRoute');
    await userEvent.click(screen.getByRole('button', { name: 'עריכת הבקשה: ייעוץ ארגוני' }));
    await userEvent.type(screen.getByLabelText(/^פטור מבוקש/u), '3(8)');
    await userEvent.click(screen.getByRole('button', { name: 'שמירת השינויים ובדיקה חוזרת' }));
    expect(await screen.findByText('השינויים לא נשמרו.')).toBeDefined();
    expect(screen.getByText(RULE_MESSAGES.request_closed)).toBeDefined();
    expect(run).not.toHaveBeenCalled();
  });
});

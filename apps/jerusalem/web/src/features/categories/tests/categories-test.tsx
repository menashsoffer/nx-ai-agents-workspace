import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { CategoriesPage } from '../categories-page.tsx';
import * as rpc from '../../../data/rpc.ts';
import type { loadRequests } from '../api/requests.ts';
import { DataError } from '../../../data/client.ts';
function data(): Awaited<ReturnType<typeof loadRequests>> {
  return {
    userId: 'admin',
    requests: [
      {
        id: 'request',
        proposed_name: 'ייעוץ אקוסטי',
        description: 'נדרש תחום חסר',
        parent_id: 'existing',
        source_reference: 'https://example.test/doc',
        created_by: 'viewer',
      },
    ],
    categories: [
      { id: 'existing', name: 'ייעוץ סביבתי' },
      { id: 'other', name: 'תכנון ערים' },
    ],
  };
}
function page(value = data()) {
  const router = createMemoryRouter(
    [{ id: 'categories', path: '/', Component: CategoriesPage, loader: () => value }],
    { hydrationData: { loaderData: { categories: value } } },
  );
  render(<RouterProvider router={router} />);
  return value;
}
async function open(action: string) {
  await userEvent.click(screen.getByRole('button', { name: action }));
  return screen.getByRole('form', { name: `${action}: ייעוץ אקוסטי` });
}
const emptied = (value: ReturnType<typeof data>, result: string | null) =>
  vi.spyOn(rpc, 'rpc').mockImplementation((_name, _args, schema) => {
    value.requests = [];
    return Promise.resolve(schema.parse(result));
  });
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
describe('category review', () => {
  it('shows the request with its parent and source, and three decisions', () => {
    page();
    expect(screen.getByRole('heading', { name: 'בקשות קטגוריה (1)', level: 1 })).toBeDefined();
    expect(screen.getAllByText('ייעוץ סביבתי')[0]?.tagName).toBe('DD');
    expect(screen.getByRole('link', { name: 'פתיחת המקור' }).getAttribute('href')).toBe(
      'https://example.test/doc',
    );
    for (const name of ['אישור כקטגוריה חדשה', 'קישור לקטגוריה קיימת', 'דחייה']) {
      expect(screen.getByRole('button', { name })).toBeDefined();
    }
  });
  it('hides linking when there is no category to link to', () => {
    const value = data();
    value.categories = [];
    value.requests = value.requests.map((r) => ({ ...r, parent_id: null, source_reference: 'x' }));
    page(value);
    expect(screen.getByText('קטגוריה ראשית')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'קישור לקטגוריה קיימת' })).toBeNull();
  });
  it('requires a reason before rejection', async () => {
    page();
    const call = vi.spyOn(rpc, 'rpc');
    const form = await open('דחייה');
    await userEvent.click(within(form).getByRole('button', { name: 'דחייה' }));
    expect(await within(form).findByText('שדה חובה.')).toBeDefined();
    expect(call).not.toHaveBeenCalled();
  });
  it('approves only after the RPC succeeds and then refreshes the list', async () => {
    const value = page();
    const call = emptied(value, 'new-category');
    const form = await open('אישור כקטגוריה חדשה');
    await userEvent.type(within(form).getByRole('textbox', { name: /נימוק לאישור/ }), 'תחום חדש');
    await userEvent.click(within(form).getByRole('button', { name: 'אישור כקטגוריה חדשה' }));
    expect(await screen.findByRole('heading', { name: 'אין בקשות קטגוריה ממתינות' })).toBeDefined();
    expect(call.mock.calls[0]?.slice(0, 2)).toEqual([
      'decide_category_request',
      { request_id: 'request', decision: 'approved', note: 'תחום חדש', category_id: null },
    ]);
  });
  it('links to a searched category, keeping the reason when none was chosen', async () => {
    const value = page();
    const call = emptied(value, 'other');
    const form = await open('קישור לקטגוריה קיימת');
    const note = within(form).getByRole('textbox', { name: /נימוק לקישור/ });
    await userEvent.type(note, 'כפילות');
    await userEvent.click(within(form).getByRole('button', { name: 'קישור לקטגוריה קיימת' }));
    expect(await within(form).findByText('יש לבחור קטגוריה קיימת לקישור.')).toBeDefined();
    expect(within(form).getByRole<HTMLInputElement>('textbox', { name: /נימוק/ }).value).toBe(
      'כפילות',
    );
    await userEvent.type(within(form).getByRole('searchbox'), 'תכנון');
    expect(within(form).queryByRole('radio', { name: 'ייעוץ סביבתי' })).toBeNull();
    await userEvent.click(within(form).getByRole('radio', { name: 'תכנון ערים' }));
    await userEvent.click(within(form).getByRole('button', { name: 'קישור לקטגוריה קיימת' }));
    expect(await screen.findByRole('heading', { name: 'אין בקשות קטגוריה ממתינות' })).toBeDefined();
    expect(call.mock.calls[0]?.[1]).toMatchObject({ decision: 'linked', category_id: 'other' });
  });
  it('says so when no category matches the search', async () => {
    page();
    const form = await open('קישור לקטגוריה קיימת');
    await userEvent.type(within(form).getByRole('searchbox'), 'אין כזה');
    expect(within(form).getByText('אין קטגוריה שמתאימה לחיפוש.')).toBeDefined();
  });
  it('keeps the request visible when the database denies approval', async () => {
    page();
    vi.spyOn(rpc, 'rpc').mockRejectedValue(new DataError(403));
    const form = await open('אישור כקטגוריה חדשה');
    await userEvent.type(within(form).getByRole('textbox', { name: /נימוק/ }), 'תחום חדש');
    await userEvent.click(within(form).getByRole('button', { name: 'אישור כקטגוריה חדשה' }));
    expect((await within(form).findByRole('alert')).textContent).toContain('אין לך הרשאה');
    expect(screen.getByRole('heading', { name: 'ייעוץ אקוסטי' })).toBeDefined();
  });
  it('refreshes the list when another administrator already decided the request', async () => {
    const value = page();
    vi.spyOn(rpc, 'rpc').mockImplementation(() => {
      value.requests = [];
      return Promise.reject(new DataError(404));
    });
    const form = await open('דחייה');
    await userEvent.type(within(form).getByRole('textbox', { name: /נימוק/ }), 'לא נדרש');
    await userEvent.click(within(form).getByRole('button', { name: 'דחייה' }));
    expect(await screen.findByRole('heading', { name: 'אין בקשות קטגוריה ממתינות' })).toBeDefined();
  });
});

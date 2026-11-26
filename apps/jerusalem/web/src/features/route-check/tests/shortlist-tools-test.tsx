import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { DataError } from '../../../data/client.ts';
import * as engagement from '../api/engagement.ts';
import { PickedList } from '../components/picked-list.tsx';
import { ShortlistTools } from '../components/shortlist-tools.tsx';
import type { PickedSupplier } from '../model/engagement.ts';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const active: PickedSupplier = {
  id: A,
  name: 'ספק א',
  inactive: false,
  emails: ['a@x.test'],
  phones: ['02-1'],
  lastApproached: null,
};
const inactive: PickedSupplier = { ...active, id: B, name: 'ספק ב', inactive: true, emails: [] };

function clipboard(write: (text: string) => Promise<void>) {
  const writeText = vi.fn(write);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

function tools(suppliers: PickedSupplier[], requestId: string | null = null) {
  render(<ShortlistTools suppliers={suppliers} today="2026-11-17" requestId={requestId} />);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
});

/** jsdom has no dialog commands: the test opens the dialog the button would open. */
function openApproach(): HTMLDialogElement {
  const dialog = screen.getByRole<HTMLDialogElement>('dialog', { hidden: true });
  dialog.setAttribute('open', '');
  return dialog;
}

describe('shortlist tools', () => {
  it('copies one address per active supplier for BCC', async () => {
    const writeText = clipboard(() => Promise.resolve());
    tools([active, inactive]);
    await userEvent.click(screen.getByRole('button', { name: 'העתקת כתובות ל-BCC' }));
    expect(writeText).toHaveBeenCalledWith('a@x.test');
    expect(await screen.findByText('הועתקו 1 כתובות דוא״ל.')).toBeDefined();
  });

  it('says so when no supplier has an address, without touching the clipboard', async () => {
    const writeText = clipboard(() => Promise.resolve());
    tools([inactive]);
    await userEvent.click(screen.getByRole('button', { name: 'העתקת כתובות ל-BCC' }));
    expect(await screen.findByText('לאף ספק בבקשה אין דוא״ל במאגר.')).toBeDefined();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does not claim a copy that the browser refused', async () => {
    clipboard(() => Promise.reject(new Error('denied')));
    tools([active]);
    await userEvent.click(screen.getByRole('button', { name: 'העתקת כתובות ל-BCC' }));
    expect(await screen.findByText('ההעתקה נכשלה.')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'העתקת קישור' }));
    expect(await screen.findByText('ההעתקה נכשלה.')).toBeDefined();
  });

  it('copies a link that reopens the same list', async () => {
    const writeText = clipboard(() => Promise.resolve());
    tools([active, inactive]);
    await userEvent.click(screen.getByRole('button', { name: 'העתקת קישור' }));
    expect(writeText.mock.calls[0]?.[0]).toContain(`#/engagement?suppliers=${A}%2C${B}`);
    expect(await screen.findByText(/הקישור הועתק/u)).toBeDefined();
  });

  it('downloads a CSV file named after the day and releases it afterwards', async () => {
    const created = vi.fn(() => 'blob:csv');
    const revoked = vi.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      expect(document.querySelector('a[download]')?.getAttribute('download')).toBe(
        'ספקים-לבקשה-2026-11-17.csv',
      );
    });
    tools([active]);
    await userEvent.click(screen.getByRole('button', { name: 'ייצוא לקובץ' }));
    expect(await screen.findByText('הקובץ הורד, בלי מספרי זהות.')).toBeDefined();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    await vi.waitFor(() => {
      expect(revoked).toHaveBeenCalledWith('blob:csv');
    });
  });

  it('shows the approach button only for a saved request and records active suppliers', async () => {
    tools([active]);
    expect(screen.queryByRole('button', { name: /רישום פנייה/u })).toBeNull();
    cleanup();
    const record = vi.spyOn(engagement, 'recordApproaches').mockResolvedValue(1);
    tools([active, inactive], 'req-1');
    const dialog = openApproach();
    expect(within(dialog).getByLabelText<HTMLInputElement>(/עד מתי לענות/u).min).toBe('2026-11-18');
    await userEvent.selectOptions(within(dialog).getByLabelText(/איך פניתם/u), 'portal');
    await userEvent.click(within(dialog).getByRole('button', { name: 'רישום הפנייה' }));
    expect(record).toHaveBeenCalledWith({
      request: 'req-1',
      suppliers: [A],
      channel: 'portal',
      respondBy: '2026-11-24',
    });
    expect(await screen.findByText('נרשמו 1 פניות, עם מועד לתשובה 24.11.2026.')).toBeDefined();
    expect(dialog.open).toBe(false);
  });

  it('shows the server message or a general one when recording fails', async () => {
    const record = vi.spyOn(engagement, 'recordApproaches');
    record.mockRejectedValueOnce(new DataError(403)).mockRejectedValueOnce(new Error('x'));
    tools([active], 'req-1');
    const dialog = openApproach();
    const button = within(dialog).getByRole('button', { name: 'רישום הפנייה' });
    await userEvent.click(button);
    expect((await within(dialog).findByRole('alert')).textContent).toBe(new DataError(403).message);
    await userEvent.click(button);
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/תקלה במערכת/u);
  });
});

describe('picked list', () => {
  it('marks inactive suppliers and missing addresses, and removes on request', async () => {
    const remove = vi.fn();
    render(<PickedList suppliers={[active, inactive]} remove={remove} />);
    expect(screen.getByText(/לא פעיל, לא ניתן לפנות אליו/u)).toBeDefined();
    expect(screen.getByText(/אין דוא״ל במאגר/u)).toBeDefined();
    expect(screen.getByText(/יש דוא״ל/u)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'הסרה מהבקשה: ספק ב' }));
    expect(remove).toHaveBeenCalledWith(B);
  });
});

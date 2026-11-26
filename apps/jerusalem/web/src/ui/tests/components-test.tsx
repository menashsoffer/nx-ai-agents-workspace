import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Button } from '../button.tsx';
import { FormField } from '../form-field.tsx';
import { SelectField } from '../select-field.tsx';
import { Dialog } from '../dialog.tsx';
import { DataTable } from '../data-table.tsx';
import { StatusMessage } from '../status-message.tsx';
import { EmptyState } from '../empty-state.tsx';
import { Skeleton } from '../skeleton.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('shared accessible controls', () => {
  it('activates a button with the keyboard and never submits an enclosing form by default', async () => {
    const clicked = vi.fn();
    const submitted = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
    });
    render(
      <form>
        <Button onClick={clicked}>פתיחה</Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'פתיחה' });
    button.closest('form')?.addEventListener('submit', submitted);
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(submitted).not.toHaveBeenCalled();
  });
  it('provides unique labels and hints and waits until blur before announcing invalid input', async () => {
    render(
      <>
        <FormField
          field={{ label: 'דוא״ל', hint: 'כתובת מלאה' }}
          input={{ name: 'email', type: 'email', required: true }}
        />
        <FormField field={{ label: 'שם' }} input={{ name: 'name' }} />
      </>,
    );
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'דוא״ל' });
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(input.id).not.toBe(screen.getByRole('textbox', { name: 'שם' }).id);
    await userEvent.type(input, 'incorrect');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    await userEvent.tab();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(`${input.id}-error`);
    await userEvent.clear(input);
    await userEvent.type(input, 'valid@example.test');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });
  it('shows field info behind an icon on hover and keeps it as the field description', async () => {
    const text = '5 עד 9 ספרות, בלי מקפים.';
    render(<FormField field={{ label: 'מזהה רשמי', info: text }} input={{ name: 'identifier' }} />);
    const input = screen.getByRole('textbox', { name: 'מזהה רשמי' });
    const id = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(id)?.textContent).toBe(text);
    const icon = screen.getByRole('button', { name: 'הסבר על השדה מזהה רשמי' });
    expect(icon.getAttribute('aria-describedby')).toBe(id);
    const bubble = icon.parentElement?.querySelector('[aria-hidden="true"]:not(svg)');
    expect(bubble?.hasAttribute('hidden')).toBe(true);
    await userEvent.hover(icon);
    expect(bubble?.hasAttribute('hidden')).toBe(false);
    expect(bubble?.textContent).toBe(text);
    await userEvent.unhover(icon);
    await userEvent.click(icon);
    expect(bubble?.hasAttribute('hidden')).toBe(false);
  });
  it('associates a supplied server error with the input', () => {
    render(<FormField field={{ label: 'שם', error: 'יש להזין שם' }} input={{ name: 'name' }} />);
    const input = screen.getByRole('textbox', { name: 'שם' });
    const id = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(id)?.textContent).toBe('יש להזין שם');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
  it('keeps a select native, labelled, and operable by the user', async () => {
    render(
      <SelectField
        field={{ label: 'יחידה' }}
        select={{
          name: 'unit',
          defaultValue: 'a',
          children: (
            <>
              <option value="a">הנדסה</option>
              <option value="b">תרבות</option>
            </>
          ),
        }}
      />,
    );
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'יחידה' });
    await userEvent.selectOptions(select, 'b');
    expect(select.value).toBe('b');
  });
  it('uses showModal and close when native invoker commands are unavailable', async () => {
    const opened = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    const closed = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });
    // jsdom has no native dialog methods; real keyboard/focus behavior is checked in Chromium.
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: opened,
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: closed,
    });
    render(
      <>
        <Button command={{ target: 'confirmation', action: 'show-modal' }}>פתיחה</Button>
        <Dialog id="confirmation" title="אישור פעולה">
          <p>תוכן החלון</p>
        </Dialog>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'פתיחה' }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'אישור פעולה' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(closed).toHaveBeenCalledTimes(1);
  });
  it('names the table and its scrollable region and associates headers by scope', () => {
    render(
      <DataTable
        caption="הצעות ממתינות"
        columns={[
          { id: 'month', label: 'חודש' },
          { id: 'amount', label: 'סכום' },
        ]}
        rows={[{ id: 'proposal-1', cells: { month: 'נובמבר', amount: <bdi>100 ₪</bdi> } }]}
      />,
    );
    expect(screen.getByRole('table', { name: 'הצעות ממתינות' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'הצעות ממתינות' }).tabIndex).toBe(0);
    expect(screen.getByRole('rowheader', { name: 'נובמבר' }).getAttribute('scope')).toBe('row');
    for (const header of screen.getAllByRole('columnheader'))
      expect(header.getAttribute('scope')).toBe('col');
  });
  it('keeps one status region present for asynchronous updates', () => {
    const { rerender } = render(<StatusMessage />);
    const status = screen.getByRole('status');
    rerender(<StatusMessage>השינוי נשמר</StatusMessage>);
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('השינוי נשמר');
  });
  it('provides a meaningful empty state and an indeterminate loading indicator', () => {
    render(
      <>
        <EmptyState title="אין הצעות ממתינות">
          <p>כל ההצעות טופלו.</p>
        </EmptyState>
        <Skeleton />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'אין הצעות ממתינות', level: 2 })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('טוען נתונים…');
  });
});

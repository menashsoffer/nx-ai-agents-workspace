// The shared building blocks of ui-building-blocks-spec-he.md (buttons, notices, forms, dialogs).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createRef } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Button } from '../button.tsx';
import { Notice } from '../notice.tsx';
import { FormField } from '../form-field.tsx';
import { ErrorSummary, RequiredNote } from '../field-parts.tsx';
import { PageHeader } from '../page-header.tsx';
import { FormActions } from '../form-actions.tsx';
import { Dialog } from '../dialog.tsx';
import { ConfirmDialog } from '../confirm-dialog.tsx';

beforeEach(() => {
  // jsdom has no native dialog methods; real keyboard/focus behavior is checked in Chromium.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});
afterEach(cleanup);

describe('buttons', () => {
  it('says it is saving and ignores another press, without leaving the tab order', async () => {
    const press = vi.fn();
    render(
      <Button pending onClick={press}>
        שמירת השינויים
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'שומר…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    await userEvent.click(button);
    expect(press).not.toHaveBeenCalled();
  });

  it('does not submit the form a second time while saving', () => {
    const submit = vi.fn((event: Event) => {
      event.preventDefault();
    });
    render(
      <form
        onSubmit={(event) => {
          submit(event.nativeEvent);
        }}
      >
        <Button type="submit" pending pendingLabel="שולח…">
          שליחה
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'שולח…' }));
    expect(submit).not.toHaveBeenCalled();
  });

  it('offers a quiet kind for cancel and similar actions', () => {
    render(<Button variant="quiet">ביטול</Button>);
    expect(screen.getByRole('button', { name: 'ביטול' }).className).toMatch(/quiet/u);
  });
});

describe('notices', () => {
  it('interrupts for an error and announces success and warnings politely', () => {
    render(
      <>
        <Notice tone="error" title="השמירה נכשלה.">
          נסו שוב.
        </Notice>
        <Notice tone="success" title="הבקשה אושרה." />
        <Notice tone="warning" title="הרשימה לא התרעננה." />
        <Notice tone="info" title="הכלי אינו מאשר התקשרות." />
      </>,
    );
    expect(screen.getByRole('alert').textContent).toBe('השמירה נכשלה.נסו שוב.');
    expect(screen.getAllByRole('status').map((n) => n.textContent)).toEqual([
      'הבקשה אושרה.',
      'הרשימה לא התרעננה.',
    ]);
    expect(screen.getByText('הכלי אינו מאשר התקשרות.').closest('[role]')).toBeNull();
  });
});

describe('forms', () => {
  it('marks a required field with a star that readers skip, since required says it', () => {
    render(
      <>
        <RequiredNote />
        <FormField field={{ label: 'שם הספק' }} input={{ name: 'name', required: true }} />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'שם הספק' });
    expect(input.hasAttribute('required')).toBe(true);
    const label = screen.getByText('שם הספק');
    expect(label.querySelector('[aria-hidden="true"]')?.textContent).toBe(' *');
    expect(screen.getByText('שדות עם * הם חובה.')).toBeDefined();
  });

  it('shows what to fix under the field after leaving it empty', async () => {
    render(<FormField field={{ label: 'שם הספק' }} input={{ name: 'name', required: true }} />);
    const input = screen.getByRole('textbox', { name: 'שם הספק' });
    await userEvent.type(input, 'א');
    await userEvent.clear(input);
    await userEvent.tab();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('יש למלא את השדה.')).toBeDefined();
  });

  it('lists every field to fix with a link to it', () => {
    const focusRef = createRef<HTMLHeadingElement>();
    const problems = [
      { id: 'name', label: 'שם הספק', message: 'יש למלא את השדה.' },
      { id: 'id', label: 'ח.פ.', message: 'מספר ח.פ. צריך 9 ספרות.' },
    ];
    const { rerender } = render(<ErrorSummary problems={problems} focusRef={focusRef} />);
    expect(focusRef.current?.textContent).toBe('יש לתקן 2 שדות');
    expect(screen.getByRole('link', { name: 'ח.פ.: מספר ח.פ. צריך 9 ספרות.' })).toBeDefined();
    rerender(<ErrorSummary problems={problems.slice(0, 1)} focusRef={focusRef} />);
    expect(focusRef.current?.textContent).toBe('יש לתקן שדה אחד');
    rerender(<ErrorSummary problems={[]} focusRef={focusRef} />);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('keeps a destructive action apart from the form buttons', () => {
    render(
      <FormActions apart={<Button variant="quiet">סימון כלא פעיל…</Button>}>
        <Button>שמירה</Button>
        <Button variant="quiet">ביטול</Button>
      </FormActions>,
    );
    const save = screen.getByRole('button', { name: 'שמירה' }).parentElement;
    const apart = screen.getByRole('button', { name: 'סימון כלא פעיל…' }).parentElement;
    expect(save).not.toBe(apart);
    expect(save?.textContent).toBe('שמירהביטול');
  });
});

describe('screen header', () => {
  it('shows the back row, the title, the line under it and the screen action', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/users',
          element: (
            <PageHeader
              title="משתמשים ותפקידים"
              lead="מי נכנס לאתר ובאיזו הרשאה."
              back={{ to: '/admin', label: 'לכל מסכי הניהול' }}
              action={<Button>הזמנת משתמש</Button>}
            />
          ),
        },
        { path: '/admin', element: <h1>ניהול</h1> },
      ],
      { initialEntries: ['/users'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 1, name: 'משתמשים ותפקידים' })).toBeDefined();
    expect(screen.getByText('מי נכנס לאתר ובאיזו הרשאה.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'הזמנת משתמש' })).toBeDefined();
    await userEvent.click(screen.getByRole('link', { name: 'לכל מסכי הניהול' }));
    expect(await screen.findByRole('heading', { name: 'ניהול' })).toBeDefined();
  });

  it('has no back row on an area home screen', () => {
    render(<PageHeader title="איתור ספקים" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('dialogs', () => {
  function editDialog(dirty: boolean) {
    render(
      <>
        <Button command={{ target: 'edit', action: 'show-modal' }}>עריכה</Button>
        <Dialog id="edit" title="עריכת ספק" dirty={dirty}>
          <p>טופס</p>
        </Dialog>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));
    return screen.getByRole<HTMLDialogElement>('dialog', { name: 'עריכת ספק' });
  }

  it('asks before throwing away unsaved changes, and keeps editing on request', async () => {
    const dialog = editDialog(true);
    expect(dialog.getAttribute('closedby')).toBe('none');
    await userEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(dialog.open).toBe(true);
    expect(screen.getByText('יש שינויים שלא נשמרו. לסגור בלי לשמור?')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'המשך עריכה' }));
    expect(screen.queryByText('יש שינויים שלא נשמרו. לסגור בלי לשמור?')).toBeNull();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await userEvent.click(screen.getByRole('button', { name: 'סגירה בלי שמירה' }));
    expect(dialog.open).toBe(false);
  });

  it('closes at once when nothing changed', async () => {
    const dialog = editDialog(false);
    expect(dialog.getAttribute('closedby')).toBe('any');
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(dialog.open).toBe(false);
  });

  function confirm(run: () => Promise<string>) {
    render(
      <>
        <Button variant="quiet" command={{ target: 'remove', action: 'show-modal' }}>
          הסרה…
        </Button>
        <ConfirmDialog
          id="remove"
          title="להסיר את התפקיד 'עורך' מדנה כהן?"
          action={{ label: 'הסרת התפקיד', run }}
        >
          <p>היא לא תוכל לערוך ספקים.</p>
        </ConfirmDialog>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'הסרה…' }));
    return screen.getByRole<HTMLDialogElement>('dialog', {
      name: "להסיר את התפקיד 'עורך' מדנה כהן?",
    });
  }

  it('confirms a hard-to-undo action with a red button and closes when it succeeds', async () => {
    const run = vi.fn(() => Promise.resolve(''));
    const dialog = confirm(run);
    const action = screen.getByRole('button', { name: 'הסרת התפקיד' });
    expect(action.className).toMatch(/danger/u);
    await userEvent.click(action);
    expect(run).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(false);
  });

  it('stays open with the reason when the action fails', async () => {
    const dialog = confirm(() => Promise.resolve('אין הרשאה להסיר את התפקיד.'));
    await userEvent.click(screen.getByRole('button', { name: 'הסרת התפקיד' }));
    expect(dialog.open).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('אין הרשאה להסיר את התפקיד.');
  });

  it('explains a failure it did not expect in plain words', async () => {
    confirm(() => Promise.reject(new Error('network')));
    await userEvent.click(screen.getByRole('button', { name: 'הסרת התפקיד' }));
    expect(screen.getByRole('alert').textContent).toBe('הפעולה לא הושלמה. נסו שוב.');
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

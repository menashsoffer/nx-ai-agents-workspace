// Cancelling a saved request that is no longer relevant (owner's request, 18.11). Nothing is
// deleted: a cancelled request keeps its checks and approaches, with the reason, and leaves
// the list. Editing opens the request in the details form (request-editor.tsx). The database
// decides who may change which unit's request.
import { useActionState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { DataError } from '../../../data/client.ts';
import { check, decisionNote } from '../../../lib/rules/forms.ts';
import { cancelRequest, type SavedRequest } from '../api/saved.ts';
import styles from './route-check.module.css';

export const CANCEL_REQUEST = 'cancel-request';

/** Draft and submitted requests can be edited; an approved one only cancelled. */
export const editable = (request: SavedRequest) =>
  request.status === 'draft' || request.status === 'submitted';

function closeDialog(id: string): void {
  const dialog = document.getElementById(id);
  if (dialog instanceof HTMLDialogElement) dialog.close();
}

function failure(cause: unknown): string {
  return cause instanceof DataError ? cause.message : 'השינוי לא נשמר. יש לנסות שוב.';
}

/** Runs `save`; on success closes the dialog. The write itself marks the list changed. */
function useSave(dialogId: string) {
  return async (save: () => Promise<void>): Promise<string> => {
    try {
      await save();
    } catch (cause) {
      return failure(cause);
    }
    closeDialog(dialogId);
    return '';
  };
}

interface Cancelling {
  error: string;
  noteError: string;
  note: string;
  attempt: number;
}

export function CancelRequest({ request }: { request: SavedRequest }) {
  const save = useSave(CANCEL_REQUEST);
  const [state, action, pending] = useActionState(
    async (previous: Cancelling, form: FormData): Promise<Cancelling> => {
      const value = form.get('note');
      const note = typeof value === 'string' ? value : '';
      const next = { error: '', noteError: '', note, attempt: previous.attempt + 1 };
      const checked = check(decisionNote('cancelled', true), { note });
      if (!checked.ok) return { ...next, noteError: checked.errors.note ?? '' };
      const error = await save(() => cancelRequest(request.id, checked.value.note.trim()));
      return { ...next, error };
    },
    { error: '', noteError: '', note: '', attempt: 0 },
  );
  return (
    <form action={action} aria-label="ביטול הבקשה" className={styles.form} noValidate>
      <p>הבקשה תוסר מהרשימה. היא לא נמחקת: הבדיקות, הפניות לספקים והסיבה נשמרים לצורכי בקרה.</p>
      {state.error && (
        <Notice tone="error" title="הבקשה לא בוטלה.">
          {state.error}
        </Notice>
      )}
      <FormField
        key={state.attempt}
        field={{ label: 'סיבת הביטול', hint: 'למשל: הצורך בוטל.', error: state.noteError }}
        input={{ name: 'note', required: true, maxLength: 2000, defaultValue: state.note }}
      />
      <FormActions>
        <Button type="submit" variant="danger" pending={pending} pendingLabel="מבטל…">
          ביטול הבקשה
        </Button>
      </FormActions>
    </form>
  );
}

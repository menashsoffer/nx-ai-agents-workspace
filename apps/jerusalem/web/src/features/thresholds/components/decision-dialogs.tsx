import { useActionState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { check, decisionNote } from '../../../lib/rules/forms.ts';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { DataError } from '../../../data/client.ts';
import { dayOf } from '../../../lib/dates.ts';
import { decideProposal, type Proposal } from '../api/proposals.ts';
import { AMOUNT_LABELS, formatMoney } from '../model/comparison.ts';

export const approveId = (id: string) => `approve-thresholds-${id}`;
export const rejectId = (id: string) => `reject-thresholds-${id}`;

/** Runs a decision; '' on success. 404 means another admin already decided it. */
function useDecide(id: string) {
  return async (approve: boolean, note: string | null = null): Promise<string> => {
    try {
      await decideProposal(id, approve, note);
    } catch (error) {
      if (error instanceof DataError && error.status === 404) {
        return '';
      }
      return errorText(error);
    }
    return '';
  };
}

/** "אישור הספים" asks once more with the amounts: every route check from that day uses them. */
export function ApproveDialog({ proposal }: { proposal: Proposal }) {
  const decide = useDecide(proposal.id);
  const [error, action, pending] = useActionState(async () => {
    const message = await decide(true);
    if (!message) {
      const dialog = document.getElementById(approveId(proposal.id));
      if (dialog instanceof HTMLDialogElement) dialog.close();
    }
    return message;
  }, '');
  const from = dayOf(proposal.valid_from);
  return (
    <Dialog id={approveId(proposal.id)} title={`לאשר את הספים מ-${from}?`}>
      <form action={action} aria-label={`אישור הספים מ-${from}`}>
        <p>מ-{from} כל בדיקת מסלול תשתמש בסכומים האלה:</p>
        <ul>
          {Object.entries(AMOUNT_LABELS).map(([key, label]) => (
            <li key={key}>
              {label}: <bdi>{formatMoney(proposal[key as keyof typeof AMOUNT_LABELS])}</bdi>
            </li>
          ))}
        </ul>
        {error && <Notice tone="error" title={error} />}
        <FormActions>
          <Button type="submit" pending={pending}>
            אישור הספים
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

interface Rejection {
  error: string;
  noteError: string;
  note: string;
  attempt: number;
}
const formNote = (form: FormData) => {
  const value = form.get('note');
  return typeof value === 'string' ? value : '';
};

/** "דחייה" needs a reason; the proposal keeps it. The current thresholds stay in force. */
export function RejectDialog({ proposal }: { proposal: Proposal }) {
  const decide = useDecide(proposal.id);
  const [state, action, pending] = useActionState(
    async (previous: Rejection, form: FormData): Promise<Rejection> => {
      const note = formNote(form);
      const next = { error: '', noteError: '', note, attempt: previous.attempt + 1 };
      const checked = check(decisionNote('rejected'), { note });
      if (!checked.ok) return { ...next, noteError: checked.errors.note ?? '' };
      const error = await decide(false, checked.value.note.trim());
      if (!error) {
        const dialog = document.getElementById(rejectId(proposal.id));
        if (dialog instanceof HTMLDialogElement) dialog.close();
      }
      return { ...next, error };
    },
    { error: '', noteError: '', note: '', attempt: 0 },
  );
  const from = dayOf(proposal.valid_from);
  return (
    <Dialog id={rejectId(proposal.id)} title={`דחיית ההצעה לספים מ-${from}`}>
      <form action={action} aria-label={`דחיית ההצעה לספים מ-${from}`} noValidate>
        <p>הספים הנוכחיים יישארו בתוקף. הצעה חדשה תיווצר עם פרסום המדד הבא.</p>
        {state.error && <Notice tone="error" title={state.error} />}
        <FormField
          key={state.attempt}
          field={{ label: 'נימוק לדחייה', hint: 'הנימוק נשמר עם ההצעה.', error: state.noteError }}
          input={{ name: 'note', required: true, maxLength: 2000, defaultValue: state.note }}
        />
        <FormActions>
          <Button type="submit" pending={pending}>
            דחיית ההצעה
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

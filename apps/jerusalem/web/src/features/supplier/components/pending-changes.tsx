import { useActionState } from 'react';
import type { ChangeRequest } from '../../../data/supplier-changes.ts';
import { errorText } from '../../../data/errors.ts';
import { dayOf } from '../../../lib/dates.ts';
import { Button } from '../../../ui/button.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { cancelChange, decideChange } from '../api/changes.ts';
import { changeLabel, changeValue, checkText, isRemoval } from '../model/change-checks.ts';
import styles from './supplier.module.css';

interface Props {
  changes: readonly ChangeRequest[];
  userId: string | null;
  admin: boolean;
  editor: boolean;
}
interface Result {
  error: string;
  noteError: string;
}
const IDLE: Result = { error: '', noteError: '' };

function useDecision(change: ChangeRequest) {
  return useActionState(async (_: Result, form: FormData): Promise<Result> => {
    const decision = form.get('decision');
    const value = form.get('note');
    const note = typeof value === 'string' ? value.trim() : '';
    if (decision === 'reject' && note.length < 2) {
      return { ...IDLE, noteError: 'צריך לכתוב סיבה לדחייה.' };
    }
    try {
      if (decision === 'cancel') await cancelChange(change);
      else await decideChange(change, decision === 'approve', note);
      return IDLE;
    } catch (error) {
      return { ...IDLE, error: errorText(error) };
    }
  }, IDLE);
}

/** Spec section 5: contacts by another editor, a name or a kind by an admin. */
const mayDecide = (change: ChangeRequest, props: Props) =>
  change.created_by !== props.userId &&
  (props.admin || (change.change_kind === 'contact' && props.editor));

function Decision({ change, own }: { change: ChangeRequest; own: boolean }) {
  const [result, action, pending] = useDecision(change);
  const label = changeLabel(change.change_kind, change.contact_kind);
  if (own) {
    return (
      <form action={action} aria-label={`ביטול הבקשה לשינוי ${label}`}>
        <Button type="submit" name="decision" value="cancel" variant="secondary" pending={pending}>
          ביטול הבקשה
        </Button>
        {result.error && <p role="alert">{result.error}</p>}
      </form>
    );
  }
  return (
    <form action={action} aria-label={`החלטה על שינוי ${label}`}>
      <FormField
        field={{ label: 'נימוק', hint: 'חובה בדחייה', error: result.noteError }}
        input={{ name: 'note', maxLength: 500 }}
      />
      <div className={styles.dialogActions}>
        <Button type="submit" name="decision" value="approve" pending={pending}>
          אישור
        </Button>
        <Button type="submit" name="decision" value="reject" variant="secondary" pending={pending}>
          דחייה
        </Button>
      </div>
      {result.error && <p role="alert">{result.error}</p>}
    </form>
  );
}

function PendingChange({ change, props }: { change: ChangeRequest; props: Props }) {
  const label = changeLabel(change.change_kind, change.contact_kind);
  const own = change.created_by === props.userId;
  return (
    <article className={styles.card} aria-label={`שינוי ${label} ממתין`}>
      <h3>
        {isRemoval(change.change_kind, change.new_value)
          ? `מחיקת ${label}: ${changeValue(change.change_kind, change.old_value)}`
          : `${label}: ${changeValue(change.change_kind, change.old_value)} ← ${changeValue(change.change_kind, change.new_value)}`}
      </h3>
      <p>
        {own ? 'הבקשה שלך' : change.origin === 'supplier' ? 'הספק הציע' : 'נשלחה'} ב-
        {dayOf(change.created_at)}
        {change.reason ? `. הסיבה: ${change.reason}` : ''}
      </p>
      <p>{change.checks.map(checkText).join(' ')}</p>
      {(own || mayDecide(change, props)) && <Decision change={change} own={own} />}
    </article>
  );
}

/** "שינויים ממתינים" on the supplier page: shown only when there is something to see. */
export function PendingChanges(props: Props) {
  if (props.changes.length === 0) return null;
  return (
    <section aria-labelledby="pending-changes">
      <h2 id="pending-changes">שינויים ממתינים לאישור</h2>
      {props.changes.map((change) => (
        <PendingChange key={change.id} change={change} props={props} />
      ))}
    </section>
  );
}

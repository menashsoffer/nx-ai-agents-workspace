import { useActionState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { EmptyState } from '../../../ui/empty-state.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { errorText } from '../../../data/errors.ts';
import { dayOf } from '../../../lib/dates.ts';
import { changeSummary, detailsText } from '../../../data/access-change-labels.ts';
import { decideChange, type PendingChange } from '../api/changes.ts';
import type { GrantRow, Profile } from '../api/users.ts';
import { noteError } from '../model/permissions.ts';
import styles from './users.module.css';

interface Props {
  change: PendingChange;
  profiles: Profile[];
  grants: GrantRow[];
  units: ReadonlyMap<string, string>;
}
interface Result {
  error: string;
  fieldError: string;
}
const IDLE: Result = { error: '', fieldError: '' };

function useDecision(id: string) {
  return useActionState(async (_: Result, form: FormData): Promise<Result> => {
    const approve = form.get('decision') === 'approve';
    const value = form.get('note');
    const note = typeof value === 'string' ? value.trim() : '';
    const invalid = noteError(approve ? 'active' : 'rejected', note);
    if (invalid) return { ...IDLE, fieldError: invalid };
    try {
      await decideChange(id, approve, note);
      return IDLE;
    } catch (error) {
      return { ...IDLE, error: errorText(error) };
    }
  }, IDLE);
}

/** One pending change request (screens-spec 4.1): who, what, why, then approve or reject. */
export function ChangeReview({ change, profiles, grants, units }: Props) {
  const [result, action, pending] = useDecision(change.id);
  const person = profiles.find((p) => p.user_id === change.user_id);
  const name = person ? `${person.first_name} ${person.last_name}` : 'משתמש';
  const summary = changeSummary(change, units, grants);
  return (
    <article className={styles.card} aria-label={`${summary}, ${name}`}>
      <h3>
        {name}: {summary}
      </h3>
      {change.kind === 'details' && <p>{detailsText(change.details)}</p>}
      <p>
        נשלחה ב-{dayOf(change.created_at)}. הסיבה: {change.reason}
      </p>
      <form action={action} aria-label={`החלטה על בקשת ${name}`}>
        <FormField
          field={{ label: 'נימוק', hint: 'חובה בדחייה', error: result.fieldError }}
          input={{ name: 'note', maxLength: 2000 }}
        />
        <div className={styles.actions}>
          <Button type="submit" name="decision" value="approve" pending={pending}>
            אישור
          </Button>
          <Button
            type="submit"
            name="decision"
            value="reject"
            variant="secondary"
            pending={pending}
          >
            דחייה
          </Button>
        </div>
        {result.error && <p role="alert">{result.error}</p>}
      </form>
    </article>
  );
}

type ListProps = Omit<Props, 'change'> & { changes: PendingChange[] };

/** "בקשות שינוי ממתינות" on the users screen. */
export function ChangeRequests({ changes, ...rest }: ListProps) {
  return (
    <>
      <h2>בקשות שינוי ממתינות</h2>
      {changes.length ? (
        changes.map((change) => <ChangeReview key={change.id} change={change} {...rest} />)
      ) : (
        <EmptyState title="אין בקשות שינוי ממתינות" />
      )}
    </>
  );
}

import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { RequiredNote } from '../../../ui/field-parts.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { dayOf } from '../../../lib/dates.ts';
import { changedDetails, detailsForm } from '../model/account-forms.ts';
import { askDetails, type ChangeRequest, type MyProfile } from '../api/account.ts';
import { CancelChange } from './cancel-change.tsx';
import { PersonFields } from './person-fields.tsx';
import { useAccountForm } from './use-account-form.ts';
import styles from './account.module.css';

interface Props {
  profile: MyProfile;
  unit: string;
  /** Null where change requests are not available yet: then the details are read-only. */
  changes: ChangeRequest[] | null;
  /** The edit form is opened from the actions at the top of the personal area. */
  editing: boolean;
  setEditing: (editing: boolean) => void;
  /** An admin's change is saved at once instead of waiting for approval. */
  admin: boolean;
}

function DetailsForm({
  profile,
  admin,
  done,
}: {
  profile: MyProfile;
  admin: boolean;
  done: () => void;
}) {
  const refresh = useRevalidator();
  const [state, action, pending] = useAccountForm(detailsForm, async (input) => {
    const details = changedDetails(input, profile);
    if (!Object.keys(details).length) throw new Error('לא שונה אף פרט.');
    await askDetails(details, input.reason);
    done();
    await refresh.revalidate();
  });
  return (
    <form action={action} aria-label="עריכת הפרטים שלי" noValidate className={styles.form}>
      <RequiredNote />
      {state.failure && (
        <Notice tone="error" title={admin ? 'השינוי לא נשמר.' : 'השינוי לא נשלח.'}>
          {state.failure}
        </Notice>
      )}
      <PersonFields errors={state.errors} typed={state.typed} values={profile} />
      <FormField
        field={{ label: 'סיבת השינוי', error: state.errors.reason }}
        input={{ name: 'reason', required: true, defaultValue: state.typed.reason ?? '' }}
      />
      <FormActions>
        <Button type="submit" pending={pending} pendingLabel={admin ? 'שומר…' : 'שולח…'}>
          {admin ? 'שמירת השינוי' : 'שליחת השינוי לאישור'}
        </Button>
        <Button variant="quiet" onClick={done}>
          ביטול
        </Button>
      </FormActions>
    </form>
  );
}

function Facts({ profile, unit }: Pick<Props, 'profile' | 'unit'>) {
  return (
    <dl className={styles.facts}>
      <div>
        <dt>שם</dt>
        <dd>
          {profile.first_name} {profile.last_name}
        </dd>
      </div>
      <div>
        <dt>תפקיד בעירייה</dt>
        <dd>{profile.job_title}</dd>
      </div>
      <div>
        <dt>טלפון</dt>
        <dd>{profile.phone ? <bdi>{profile.phone}</bdi> : 'לא נמסר'}</dd>
      </div>
      <div>
        <dt>יחידה</dt>
        <dd>{unit}</dd>
      </div>
    </dl>
  );
}

/** "הפרטים שלי": shown as facts; a change goes to a manager for approval (decision 8). */
export function MyDetails({ profile, unit, changes, editing, setEditing, admin }: Props) {
  const waiting = changes?.find((c) => c.kind === 'details' && c.status === 'pending');
  return (
    <section aria-labelledby="my-details" className={styles.panel}>
      <h2 id="my-details">הפרטים שלי</h2>
      {editing && changes && !waiting ? (
        <DetailsForm
          profile={profile}
          admin={admin}
          done={() => {
            setEditing(false);
          }}
        />
      ) : (
        <Facts profile={profile} unit={unit} />
      )}
      {waiting && (
        <Notice tone="info" title={`השינוי נשלח ב-${dayOf(waiting.created_at)} וממתין לאישור.`}>
          עד האישור הפרטים הקודמים נשארים. <CancelChange id={waiting.id} />
        </Notice>
      )}
      <p className={styles.note}>
        הדוא״ל הוא כתובת הכניסה ואינו נערך. לכתובת אחרת פונים למנהל המערכת.
      </p>
    </section>
  );
}

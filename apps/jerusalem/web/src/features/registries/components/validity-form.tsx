import { useActionState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { StatusMessage } from '../../../ui/status-message.tsx';
import { saveValidity, type RegistryDetail } from '../api/registries.ts';
import { dateInput } from '../model/review.ts';
import styles from './registries.module.css';

interface Result {
  error: string;
  saved: boolean;
}

/** "בתוקף עד" from the call for proposals. Members without their own date inherit it. */
export function ValidityForm({ registry }: { registry: RegistryDetail }) {
  const [state, action, saving] = useActionState(
    async (_previous: Result, form: FormData): Promise<Result> => {
      const error = await saveValidity(registry.version_id, dateInput(form.get('valid_until')));
      return { error, saved: !error };
    },
    { error: '', saved: false },
  );
  return (
    <form action={action} aria-label="תוקף המאגר" className={styles.validity}>
      <FormField
        field={{
          label: 'בתוקף עד',
          hint: 'לפי הקול הקורא. ספק בלי תאריך משלו מקבל את התאריך הזה. ריק: אין תאריך.',
        }}
        input={{
          name: 'valid_until',
          type: 'date',
          defaultValue: registry.valid_until ?? '',
          min: registry.valid_from ?? undefined,
        }}
      />
      <Button type="submit" pending={saving} pendingLabel="שומר…">
        שמירת התוקף
      </Button>
      <StatusMessage>{state.saved && !saving ? 'התוקף נשמר.' : ''}</StatusMessage>
      {state.error && <Notice tone="error" title={state.error} />}
    </form>
  );
}

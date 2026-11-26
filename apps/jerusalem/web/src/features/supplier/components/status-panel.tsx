import { supplierKey } from '../../../data/react-catalog.ts';
import { useActionState } from 'react';
import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { check, statusForm, type FieldErrors } from '../../../lib/rules/forms.ts';
import { Button } from '../../../ui/button.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { IDLE, saveAndRefresh, status, type SaveResult } from '../api/write.ts';
import { formText } from '../model/add-form.ts';
import { SaveStatus } from './save-status.tsx';
import styles from './supplier.module.css';

interface Props {
  data: SupplierDetail;
  today: string;
  cancel: () => void;
}
interface State extends SaveResult {
  errors: FieldErrors;
  typed: Record<string, string>;
}
const START: State = { ...IDLE, errors: {}, typed: {} };

function useStatusAction({ data, today }: Omit<Props, 'cancel'>) {
  const { supplier } = data;
  const refresh = supplierKey(supplier.id);
  return useActionState(async (_: State, form: FormData): Promise<State> => {
    if (supplier.status === 'inactive') {
      const result = await saveAndRefresh(
        status(supplier.id, { active: true }),
        refresh,
        'הספק סומן כפעיל.',
      );
      return { ...result, errors: {}, typed: {} };
    }
    const typed = {
      reason: formText(form, 'reason'),
      source: formText(form, 'source'),
      changed_on: formText(form, 'changed_on'),
    };
    const checked = check(statusForm(today), {
      reason: formText(form, 'reason'),
      source: formText(form, 'source'),
      changed_on: formText(form, 'changed_on'),
    });
    if (!checked.ok)
      return { ...IDLE, error: 'יש לתקן את השדות המסומנים.', errors: checked.errors, typed };
    const { reason, source, changed_on: changedOn } = checked.value;
    const change = { active: false, reason, changedOn, ...(source ? { source } : {}) };
    const result = await saveAndRefresh(
      status(supplier.id, change),
      refresh,
      'הספק סומן כלא פעיל.',
    );
    return { ...result, errors: {}, typed: result.error ? typed : {} };
  }, START);
}

/** Admin only: confirms a status change, asking for a reason, source and date to deactivate. */
export function StatusPanel({ data, today, cancel }: Props) {
  const inactive = data.supplier.status === 'inactive';
  const [state, action, pending] = useStatusAction({ data, today });
  return (
    <form action={action} aria-label="מצב פעילות הספק" className={styles.confirm} noValidate>
      <h3>{inactive ? 'החזרת הספק לפעיל' : 'סימון הספק כלא פעיל'}</h3>
      {inactive ? (
        <p>הספק יחזור להופיע כפעיל ויהיה אפשר לפנות אליו שוב.</p>
      ) : (
        <>
          <p>ספק לא פעיל לא יוצע בבקשות התקשרות חדשות.</p>
          <FormField
            field={{ label: 'סיבה', error: state.errors.reason }}
            input={{
              name: 'reason',
              defaultValue: state.typed.reason ?? '',
              required: true,
              maxLength: 500,
            }}
          />
          <FormField
            field={{ label: 'מקור', hint: 'למשל פרסום, החלטה או מסמך', error: state.errors.source }}
            input={{ name: 'source', defaultValue: state.typed.source ?? '', maxLength: 500 }}
          />
          <FormField
            field={{ label: 'מתאריך', error: state.errors.changed_on }}
            input={{
              name: 'changed_on',
              type: 'date',
              defaultValue: state.typed.changed_on ?? today,
              max: today,
              required: true,
            }}
          />
        </>
      )}
      <div className={styles.dialogActions}>
        <Button type="submit" variant={inactive ? 'primary' : 'danger'} pending={pending}>
          {inactive ? 'אישור סימון כפעיל' : 'אישור סימון כלא פעיל'}
        </Button>
        <Button variant="secondary" onClick={cancel}>
          ביטול
        </Button>
      </div>
      <SaveStatus pending={pending} saving="שומר…" message={state.message} />
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}

import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { RequiredNote } from '../../../ui/field-parts.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { clearCatalog } from '../../../data/site.ts';
import { accessForm } from '../model/account-forms.ts';
import { requestAccess, type Unit } from '../api/account.ts';
import { PersonFields } from './person-fields.tsx';
import { useAccountForm } from './use-account-form.ts';

interface Props {
  userId: string;
  units: Unit[];
}

function UnitSelect({
  units,
  error,
  typed,
}: {
  units: Unit[];
  error: string | undefined;
  typed: string;
}) {
  return (
    <SelectField
      field={{ label: 'יחידה', error }}
      select={{
        name: 'unit_id',
        required: true,
        defaultValue: typed,
        children: [
          <option key="" value="">
            בחירת יחידה
          </option>,
          ...units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          )),
        ],
      }}
    />
  );
}

/** Signed in with no profile yet: the access request (screens-spec 4, decision 3). */
export function AccessRequest({ userId, units }: Props) {
  const refresh = useRevalidator();
  const [state, action, pending] = useAccountForm(accessForm, async (input) => {
    await requestAccess(userId, input);
    await clearCatalog(userId, false);
    await refresh.revalidate();
  });
  const { errors } = state;
  return (
    <form action={action} aria-label="בקשת גישה" noValidate>
      <p>עדיין אין לך גישה. ממלאים את הבקשה, ומנהל היחידה או מנהל המערכת יאשרו אותה.</p>
      <RequiredNote />
      {state.failure && (
        <Notice tone="error" title="הבקשה לא נשלחה.">
          {state.failure}
        </Notice>
      )}
      <PersonFields errors={errors} typed={state.typed} />
      <UnitSelect
        key={state.typed.unit_id ?? ''}
        units={units}
        error={errors.unit_id}
        typed={state.typed.unit_id ?? ''}
      />
      <FormField
        field={{
          label: 'למה צריך גישה',
          hint: 'למשל: איתור יועצים לפרויקט באגף',
          error: errors.purpose,
        }}
        input={{ name: 'purpose', required: true, defaultValue: state.typed.purpose ?? '' }}
      />
      <FormActions>
        <Button type="submit" pending={pending} pendingLabel="שולח…">
          שליחת הבקשה
        </Button>
      </FormActions>
    </form>
  );
}

import { useActionState, useState } from 'react';
import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import type { FieldErrors } from '../../../lib/rules/forms.ts';
import { Button } from '../../../ui/button.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { runEdit, START, type EditState } from '../api/edit-flow.ts';
import { reasonNeeded, waitsForDecision } from '../model/change-checks.ts';
import { CONTACT_KINDS, ENTITY_KINDS } from '../model/labels.ts';
import { sortContacts } from '../model/contact-order.ts';
import { contactField, KIND, NAME, NEW_KIND, NEW_VALUE, REASON } from '../model/edit-form.ts';
import { ChangeResults } from './change-results.tsx';
import { ContactRow } from './contact-row.tsx';
import { SaveStatus } from './save-status.tsx';
import { useTouched } from './use-touched.ts';
import styles from './supplier.module.css';

interface Props {
  data: SupplierDetail;
  /** An admin's change is saved at once, and needs a reason when a check is yellow. */
  admin?: boolean;
}

interface ContactsProps {
  data: SupplierDetail;
  errors: FieldErrors;
  typed: Record<string, string>;
}
function Contacts({ data, errors, typed }: ContactsProps) {
  // Same order as the card: email, address, phones, mobiles (Menash, 22.11).
  const current = sortContacts(data.contacts.filter((item) => item.status === 'current'));
  return (
    <fieldset className={styles.fieldset}>
      <legend>פרטי קשר</legend>
      {current.map((item) => (
        <ContactRow key={item.id} item={item} error={errors[contactField(item.id)]} typed={typed} />
      ))}
      <div className={styles.newContact}>
        {/* A select keeps its choice through a form reset; a new key restores the typed one. */}
        <SelectField
          key={typed[NEW_KIND] ?? ''}
          field={{ label: 'פרט קשר חדש', error: errors[NEW_KIND] }}
          select={{
            name: NEW_KIND,
            defaultValue: typed[NEW_KIND] ?? '',
            children: [
              <option key="" value="">
                בחירת סוג
              </option>,
              ...Object.entries(CONTACT_KINDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )),
            ],
          }}
        />
        <FormField
          field={{ label: 'ערך', error: errors[NEW_VALUE] }}
          input={{ name: NEW_VALUE, defaultValue: typed[NEW_VALUE] ?? '', maxLength: 500 }}
        />
      </div>
    </fieldset>
  );
}

function KindField({ data, state }: { data: SupplierDetail; state: EditState }) {
  return (
    <SelectField
      key={state.typed[KIND] ?? ''}
      field={{ label: 'סוג ישות', error: state.errors[KIND] }}
      select={{
        name: KIND,
        defaultValue: state.typed[KIND] ?? data.supplier.entity_kind,
        children: Object.entries(ENTITY_KINDS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        )),
      }}
    />
  );
}

function saveLabel(state: EditState, admin: boolean): string {
  return state.checked && waitsForDecision(state.checked, admin) ? 'שליחה לאישור' : 'שמירה';
}

function NameField({ data, state }: { data: SupplierDetail; state: EditState }) {
  return (
    <FormField
      field={{ label: 'שם הספק', error: state.errors[NAME] }}
      input={{
        name: NAME,
        defaultValue: state.typed[NAME] ?? data.supplier.display_name,
        required: true,
        maxLength: 300,
      }}
    />
  );
}

/**
 * One form, one save (spec 6.6): the shared rules check every field first, then the
 * database checks each change in green, yellow or red before anything is saved.
 */
export function EditForm({ data, admin = false }: Props) {
  const [version, setVersion] = useState(0);
  const { touched, setTouched, form } = useTouched();
  const [state, action, pending] = useActionState(async (previous: EditState, form: FormData) => {
    const next = await runEdit(previous, form, { data, admin });
    if (next.done) {
      setVersion((value) => value + 1);
      setTouched(false);
    }
    return next;
  }, START);
  const askReason = state.checked !== null && reasonNeeded(state.checked, admin);
  return (
    <form ref={form} action={action} aria-label="עריכת פרטי הספק" key={version} noValidate>
      <NameField data={data} state={state} />
      <KindField data={data} state={state} />
      <Contacts data={data} errors={state.errors} typed={state.typed} />
      {state.checked && <ChangeResults checked={state.checked} admin={admin} />}
      {askReason && (
        <FormField
          field={{ label: 'סיבת השינוי', error: state.errors[REASON] }}
          input={{
            name: REASON,
            defaultValue: state.typed[REASON] ?? '',
            required: true,
            maxLength: 500,
          }}
        />
      )}
      <div className={styles.dialogActions}>
        <Button
          type="submit"
          pending={pending}
          disabled={!touched && state.checked === null}
          data-usage="supplier.save"
        >
          {saveLabel(state, admin)}
        </Button>
      </div>
      <SaveStatus pending={pending} saving="בודק ושומר…" message={state.message} />
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}

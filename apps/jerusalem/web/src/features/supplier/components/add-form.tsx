import { useActionState, useState } from 'react';
import { Link } from 'react-router';
import type { RegistryOption, WriteContext } from '../../../data/write-context.ts';
import { Button } from '../../../ui/button.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { Notice } from '../../../ui/notice.tsx';
import controls from '../../../ui/control.module.css';
import { forgetFormDraft, useFormDraft } from '../../../lib/use-form-draft.ts';
import { membership, saveAndRefresh } from '../api/write.ts';
import { parseAddForm, fieldsOf, versionLabel } from '../model/add-form.ts';
import { duplicates } from '../model/duplicates.ts';
import { ENTITY_KINDS, ID_TYPES } from '../model/labels.ts';
import { DuplicateChoices } from './duplicate-choices.tsx';
import { SaveStatus } from './save-status.tsx';
import styles from './supplier.module.css';

interface Result {
  message: string;
  error: string;
  saved: number;
  /** The supplier the last saved row belongs to, for "לכרטיס הספק". */
  supplierId: string | null;
}
const options = (entries: [string, string][]) =>
  entries.map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
const POOL_GROUPS: [boolean, string][] = [
  [true, 'מאגרים פעילים'],
  [false, 'מאגרים שמעמדם טרם אומת'],
];
/** Pools grouped by whether their status is confirmed; an empty group is left out. */
function poolOptions(versions: RegistryOption[]) {
  return POOL_GROUPS.map(([known, label]) => {
    const rows = versions.filter((v) => v.statusKnown === known);
    if (rows.length === 0) return null;
    return (
      <optgroup key={label} label={label}>
        {options(rows.map((v): [string, string] => [v.versionId, versionLabel(v)]))}
      </optgroup>
    );
  });
}
/** The tab draft of this form: kept until the supplier is saved or the tab closes. */
const DRAFT = 'add-supplier';
const MANUAL_ID_TYPES = Object.entries(ID_TYPES).filter(([key]) => key !== 'personal_id');

function PoolFields({ context }: { context: WriteContext }) {
  const [versionId, setVersion] = useState('');
  const fields = fieldsOf(context, versionId);
  return (
    <fieldset className={styles.group}>
      <legend>רישום במאגר</legend>
      <SelectField
        field={{ label: 'מאגר וגרסה' }}
        select={{
          name: 'registry_version_id',
          required: true,
          value: versionId,
          onChange: (event) => {
            setVersion(event.currentTarget.value);
          },
          children: [options([['', 'בחרו מאגר']]), poolOptions(context.versions)],
        }}
      />
      <SelectField
        key={versionId}
        field={{ label: 'תחום' }}
        select={{
          name: 'registry_field_id',
          required: true,
          disabled: !versionId,
          children: options([
            ['', versionId ? 'בחרו תחום' : 'בחרו תחילה מאגר'],
            ...fields.map((f): [string, string] => [f.id, f.source_text]),
          ]),
        }}
      />
      <Dates />
    </fieldset>
  );
}

function Dates() {
  return (
    <div className={styles.row}>
      <FormField
        field={{ label: 'תחילת רישום' }}
        input={{ name: 'registered_from', type: 'date' }}
      />
      <FormField
        field={{ label: 'סיום רישום' }}
        input={{ name: 'registered_until', type: 'date' }}
      />
      <FormField
        field={{ label: 'תחילת התקשרות' }}
        input={{ name: 'engagement_started_on', type: 'date' }}
      />
    </div>
  );
}

function Contacts() {
  return (
    <fieldset className={styles.group}>
      <legend>פרטי קשר</legend>
      <div className={styles.row}>
        <FormField
          field={{ label: 'טלפון' }}
          input={{ name: 'phone', type: 'tel', maxLength: 80 }}
        />
        <FormField
          field={{ label: 'דוא״ל' }}
          input={{ name: 'email', type: 'email', maxLength: 160, autoComplete: 'off' }}
        />
      </div>
    </fieldset>
  );
}

function Fields({ context }: { context: WriteContext }) {
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  return (
    <>
      <fieldset className={styles.group}>
        <legend>הספק</legend>
        <SupplierFields setName={setName} setIdentifier={setIdentifier} />
      </fieldset>
      <DuplicateChoices candidates={duplicates(context, name, identifier)} />
      <PoolFields context={context} />
      <Contacts />
    </>
  );
}

interface SupplierFieldsProps {
  setName: (value: string) => void;
  setIdentifier: (value: string) => void;
}
function SupplierFields({ setName, setIdentifier }: SupplierFieldsProps) {
  return (
    <>
      <FormField
        field={{ label: 'שם הספק' }}
        input={{
          name: 'display_name',
          required: true,
          maxLength: 160,
          onChange: (e) => {
            setName(e.currentTarget.value);
          },
        }}
      />
      <SelectField
        field={{ label: 'סוג ישות' }}
        select={{ name: 'entity_kind', children: options(Object.entries(ENTITY_KINDS)) }}
      />
      <div className={styles.row}>
        <SelectField
          field={{ label: 'סוג מזהה' }}
          select={{
            name: 'identifier_scheme',
            children: options([['', 'ללא מזהה'], ...MANUAL_ID_TYPES]),
          }}
        />
        <FormField
          field={{ label: 'מזהה רשמי', info: '5 עד 9 ספרות, בלי מקפים. ממלאים יחד עם סוג המזהה.' }}
          input={{
            name: 'identifier',
            inputMode: 'numeric',
            pattern: '[0-9]{5,9}',
            maxLength: 9,
            onChange: (e) => {
              setIdentifier(e.currentTarget.value);
            },
          }}
        />
      </div>
    </>
  );
}

async function submit(previous: Result, form: FormData): Promise<Result> {
  const parsed = parseAddForm(form);
  if (!parsed.payload) return { ...previous, message: '', error: parsed.error };
  let supplierId: string | null = null;
  const save = membership(parsed.payload);
  const outcome = await saveAndRefresh(
    async (token) => {
      supplierId = await save(token);
      return supplierId;
    },
    null,
    'הספק נוסף וממתין לאימות של משתמש אחר.',
  );
  if (outcome.error) return { ...previous, ...outcome };
  forgetFormDraft(DRAFT);
  return { ...outcome, saved: previous.saved + 1, supplierId };
}

function Saved({ result, again }: { result: Result; again: () => void }) {
  if (!result.message) return null;
  return (
    <Notice tone="success" title={result.message}>
      {result.supplierId && (
        <Link to={`/supplier/${encodeURIComponent(result.supplierId)}`}>לכרטיס הספק</Link>
      )}{' '}
      <Button variant="quiet" onClick={again}>
        הוספת ספק נוסף
      </Button>
    </Notice>
  );
}

/** A saved form remounts its fields (new key), which clears every value and duplicate hint. */
export function AddForm({ context }: { context: WriteContext }) {
  const [result, action, pending] = useActionState(submit, {
    message: '',
    error: '',
    saved: 0,
    supplierId: null,
  });
  const form = useFormDraft(DRAFT);
  return (
    <form ref={form} action={action} aria-label="הוספת ספק למאגר" className={styles.addForm}>
      {/* Floats at the top of the screen while the form scrolls, so the outcome of a save is in
          view from the submit button at the bottom too. */}
      <div className={styles.feedback} data-floating="">
        <Saved
          result={result}
          again={() => {
            form.current?.querySelector<HTMLInputElement>('input[name="display_name"]')?.focus();
          }}
        />
        {result.error && (
          <Notice tone="error" title="הספק לא נוסף.">
            {result.error}
          </Notice>
        )}
      </div>
      <Fields key={result.saved} context={context} />
      <FormActions>
        <Button type="submit" pending={pending} pendingLabel="שומר…" data-usage="supplier.add">
          הוספת הספק
        </Button>
        <Link to="/catalog" className={controls.quiet}>
          ביטול
        </Link>
      </FormActions>
      <SaveStatus pending={pending} saving="שומר…" />
    </form>
  );
}

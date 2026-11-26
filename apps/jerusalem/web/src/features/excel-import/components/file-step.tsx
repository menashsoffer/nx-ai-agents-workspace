import { useActionState, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { dayOf } from '../../../lib/dates.ts';
import type { ImportContext, Target } from '../api/import.ts';
import { FILE_PROBLEMS, openFile, type OpenedFile } from '../model/read.ts';
import styles from './import.module.css';

const NONE = '';
const NEW = 'new';

interface Props {
  context: ImportContext;
  onOpened: (file: OpenedFile, target: Target) => void;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** Which registry and version the rows belong to; none means suppliers without memberships. */
function targetOf(form: FormData): Target | string {
  const registry = text(form, 'registry');
  if (registry === NONE) return {};
  if (registry === NEW) {
    const name = text(form, 'registry_name');
    return name.length >= 2 ? { registry_name: name } : 'צריך לכתוב את שם המאגר החדש.';
  }
  const version = text(form, 'version');
  return version === NEW
    ? { registry_id: registry }
    : { registry_id: registry, registry_version_id: version };
}

function VersionField({ context, registry }: { context: ImportContext; registry: string }) {
  const versions = context.versions.filter((v) => v.registry_id === registry);
  return (
    <SelectField
      field={{ label: 'גרסת המאגר', hint: 'גרסה חדשה נוצרת מהקובץ הזה.' }}
      select={{
        name: 'version',
        defaultValue: NEW,
        children: [
          <option key={NEW} value={NEW}>
            גרסה חדשה
          </option>,
          ...versions.map((v) => (
            <option key={v.id} value={v.id}>
              {`גרסה מ-${dayOf(v.valid_from ?? v.created_at)}`}
            </option>
          )),
        ],
      }}
    />
  );
}

function RegistryFields({
  context,
  registry,
  onRegistry,
}: {
  context: ImportContext;
  registry: string;
  onRegistry: (value: string) => void;
}) {
  return (
    <>
      <SelectField
        field={{ label: 'מאגר', hint: 'בלי מאגר נקלטים ספקים ופרטי קשר, בלי שיוך.' }}
        select={{
          name: 'registry',
          value: registry,
          onChange: (e) => {
            onRegistry(e.currentTarget.value);
          },
          children: [
            <option key={NONE} value={NONE}>
              בלי מאגר
            </option>,
            ...context.registries.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            )),
            <option key={NEW} value={NEW}>
              מאגר חדש…
            </option>,
          ],
        }}
      />
      {registry === NEW && (
        <FormField
          field={{ label: 'שם המאגר החדש' }}
          input={{ name: 'registry_name', required: true, maxLength: 300 }}
        />
      )}
      {registry !== NONE && registry !== NEW && (
        <VersionField context={context} registry={registry} />
      )}
    </>
  );
}

/** Step 1 (spec 6.1): the file and the registry it belongs to. */
export function FileStep({ context, onOpened }: Props) {
  const [registry, setRegistry] = useState(NONE);
  const [file, setFile] = useState<File | null>(null);
  const [error, action, opening] = useActionState(async (_: string, form: FormData) => {
    if (!file) return 'צריך לבחור קובץ.';
    const target = targetOf(form);
    if (typeof target === 'string') return target;
    const opened = await openFile(file);
    if (typeof opened === 'string') return FILE_PROBLEMS[opened];
    onOpened(opened, target);
    return '';
  }, '');
  return (
    <form action={action} className={styles.panel} aria-labelledby="import-file" noValidate>
      <h2 id="import-file">בחירת קובץ</h2>
      {error && <Notice tone="error" title={error} />}
      <FormField
        field={{ label: 'קובץ ספקים', hint: '.xlsx או .csv, עד 5 MB ועד 5,000 שורות.' }}
        input={{
          name: 'file',
          type: 'file',
          accept: '.xlsx,.csv',
          required: true,
          onChange: (e) => {
            setFile(e.currentTarget.files?.[0] ?? null);
          },
        }}
      />
      <RegistryFields context={context} registry={registry} onRegistry={setRegistry} />
      <FormActions>
        <Button type="submit" pending={opening} pendingLabel="קורא את הקובץ…">
          המשך
        </Button>
      </FormActions>
    </form>
  );
}

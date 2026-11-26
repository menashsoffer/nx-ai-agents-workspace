import { useActionState, useRef, useState } from 'react';
import { FormField } from '../../../ui/form-field.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { StatusMessage } from '../../../ui/status-message.tsx';
import { NONE, failed, notUpdated, savedButUnchecked, type Outcome } from '../model/outcome.ts';
import { checkRoute } from '../api/check.ts';
import { replaceShortlist } from '../../../lib/shortlist.ts';
import { saveRequest } from '../api/engagement.ts';
import { updateRequest } from '../api/saved.ts';
import { readDraft, type DraftFields } from '../model/draft.ts';
import { detailsOf, valuesOf, type Entry, type SavedEntry } from '../model/entry.ts';
import type { CheckResult } from '../model/result.ts';
import styles from './route-check.module.css';

interface Props {
  units: { id: string; name: string }[];
  today: string;
  back: () => void;
  /** The back button's name; the saved-request editor closes instead of stepping back. */
  backLabel?: string;
  complete: (result: CheckResult, requestId: string | null) => void;
  /** Kept by the wizard, so the details survive moving between steps. */
  entry: Entry;
  keep: (entry: Entry) => void;
  /** Empties the details and their tab draft; a saved request's editor has none. */
  clear?: () => void;
}
interface FieldsProps {
  entry: Entry;
  units: Props['units'];
  unit: string;
  change: (id: string) => void;
}

function UnitField({
  units,
  unit,
  change,
  locked,
}: Pick<Props, 'units'> & { unit: string; change: (id: string) => void; locked: boolean }) {
  const hint = locked ? 'הבקשה כבר שמורה ביחידה הזאת.' : 'בלי יחידה הבדיקה רק מחושבת ולא נשמרת.';
  return (
    <SelectField
      field={{ label: 'יחידה', hint }}
      select={{
        name: 'unit_id',
        disabled: locked,
        value: unit,
        onChange: (e) => {
          change(e.currentTarget.value);
        },
        children: [
          <option key="" value="">
            בדיקה בלבד, בלי שמירה
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

type Complete = Props['complete'];
interface Run {
  today: string;
  complete: Complete;
}

async function checkSaved(id: string, run: Run, fresh = false) {
  try {
    run.complete(await checkRoute({ request_id: id, on: run.today }), id);
    return NONE;
  } catch (error) {
    return fresh ? savedButUnchecked(error) : failed(error);
  }
}

async function checkDraft({ draft }: DraftFields, run: Run) {
  try {
    run.complete(await checkRoute({ draft, on: run.today }), null);
    return NONE;
  } catch (error) {
    return failed(error);
  }
}

/** A saved request: changed details are stored first, then it is checked again by id. */
async function resave(saved: SavedEntry, fields: DraftFields, run: Run) {
  const { details, key } = detailsOf(fields);
  if (key === saved.key) return { saved, outcome: await checkSaved(saved.id, run) };
  try {
    await updateRequest(saved.id, details);
  } catch (error) {
    return { saved, outcome: notUpdated(error) };
  }
  const next = { id: saved.id, key };
  return { saved: next, outcome: await checkSaved(saved.id, run) };
}

async function saveNew(fields: DraftFields, run: Run) {
  let id: string;
  try {
    id = await saveRequest({ ...fields.draft, unit_id: fields.unitId, subject: fields.subject });
  } catch (error) {
    return { saved: null, outcome: failed(error) };
  }
  // The picked suppliers now belong to the saved request, so the catalog tray closes.
  replaceShortlist([]);
  const saved = { id, key: detailsOf(fields).key };
  return { saved, outcome: await checkSaved(id, run, true) };
}

/**
 * With a unit the request is saved first and the check is stored; without one nothing is.
 * Once saved, later attempts update that request (when its details changed) and check it
 * again; a second copy is never saved. What was typed is kept for a return to this step.
 */
function useCheck({ entry, keep, ...run }: Run & Pick<Props, 'entry' | 'keep'>) {
  return useActionState(async (_: Outcome | null, form: FormData) => {
    const values = valuesOf(form, entry);
    keep({ ...entry, values });
    const fields = readDraft(form);
    if (typeof fields === 'string') return { tone: 'error' as const, title: fields, text: '' };
    if (!entry.saved && !fields.unitId) return checkDraft(fields, run);
    const done = entry.saved ? await resave(entry.saved, fields, run) : await saveNew(fields, run);
    keep({ values, saved: done.saved });
    // The save and the check each mark the saved list changed, so it shows the new row at once.
    return done.outcome;
  }, NONE);
}

function Fields({ entry, units, unit, change }: FieldsProps) {
  const { values } = entry;
  return (
    <>
      <FormField
        field={{ label: 'נושא' }}
        input={{ name: 'subject', maxLength: 500, required: !!unit, defaultValue: values.subject }}
      />
      <FormField
        field={{ label: 'אומדן בש״ח' }}
        input={{
          name: 'estimated_value',
          inputMode: 'decimal',
          required: true,
          dir: 'ltr',
          defaultValue: values.estimated_value,
        }}
      />
      <label className={styles.check}>
        <input type="checkbox" name="value_includes_vat" defaultChecked={values.vat} /> האומדן כולל
        מע״מ
      </label>
      <FormField
        field={{ label: 'פטור מבוקש', hint: 'אם יש, למשל 3(8).' }}
        input={{
          name: 'requested_exemption',
          maxLength: 10,
          dir: 'ltr',
          defaultValue: values.requested_exemption,
        }}
      />
      {/* A saved request stays in its unit; the database does not move it. */}
      {entry.saved && <input type="hidden" name="unit_id" value={unit} />}
      {units.length > 0 && (
        <UnitField units={units} unit={unit} change={change} locked={!!entry.saved} />
      )}
    </>
  );
}

function label(saved: boolean, unit: string): string {
  if (saved) return 'שמירת השינויים ובדיקה חוזרת';
  return unit ? 'בדיקת מסלול ושמירה ביחידה' : 'בדיקת מסלול בלבד';
}

/**
 * Step 2: the request details, filled with what was typed before. The subject is needed only
 * when the request is saved. After a save the same form edits that request.
 */
export function DraftForm(props: Props) {
  const { units, today, back, complete, entry, keep, clear, backLabel = 'לשלב הקודם' } = props;
  const [unit, setUnit] = useState(entry.values.unit_id);
  const form = useRef<HTMLFormElement>(null);
  const [outcome, action, pending] = useCheck({ today, complete, entry, keep });
  return (
    <form
      ref={form}
      action={action}
      aria-label="פרטי הבקשה"
      className={styles.form}
      onChange={(event) => {
        keep({ ...entry, values: valuesOf(new FormData(event.currentTarget), entry) });
      }}
    >
      {outcome && (
        <Notice tone={outcome.tone} title={outcome.title}>
          {outcome.text}
        </Notice>
      )}
      <fieldset className={styles.fields}>
        <Fields entry={entry} units={units} unit={unit} change={setUnit} />
      </fieldset>
      <FormActions>
        <Button type="submit" pending={pending} pendingLabel="בודק…" data-usage="request.check">
          {label(!!entry.saved, unit)}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            if (form.current)
              keep({ ...entry, values: valuesOf(new FormData(form.current), entry) });
            back();
          }}
          disabled={pending}
        >
          {backLabel}
        </Button>
        {!entry.saved && clear && (
          <Button variant="quiet" onClick={clear} disabled={pending} data-usage="request.clear">
            ניקוי הפרטים
          </Button>
        )}
      </FormActions>
      <StatusMessage>{pending ? 'בודק את המסלול…' : ''}</StatusMessage>
    </form>
  );
}

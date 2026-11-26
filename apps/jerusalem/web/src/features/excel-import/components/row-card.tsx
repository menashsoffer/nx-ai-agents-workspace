import { FormField } from '../../../ui/form-field.tsx';
import { HEADERS, type Field } from '../model/columns.ts';
import { MATCH_LABELS, type Choice, type ReviewRow } from '../model/decisions.ts';
import type { Edited } from '../model/values.ts';
import type { Existing } from '../api/existing.ts';
import { Compare } from './compare.tsx';
import styles from './import.module.css';

interface Props {
  row: ReviewRow;
  existing: Existing | undefined;
  onChoice: (choice: Choice) => void;
  onEdit: (edited: Edited) => void;
}

const EDITABLE = [
  'name',
  'value',
  'phone',
  'email',
  'address',
  'contact_person',
  'website',
] as const;
const SHOWN: readonly Field[] = ['value', 'field', 'phone', 'email', 'address', 'website'];

const BADGES: Record<Choice['decision'], string> = {
  new: 'ספק חדש',
  link: 'שיוך לספק קיים',
  hold: 'לבדיקה',
  skip: 'דילוג',
};

const keyOf = (choice: Choice) => (choice.decision === 'link' ? choice.target : choice.decision);

function SkipNote({ current, onChoice }: { current: Choice; onChoice: Props['onChoice'] }) {
  if (current.decision !== 'skip') return null;
  return (
    <div className={styles.note}>
      <FormField
        field={{ label: 'סיבת הדילוג', hint: 'נשמרת ליד השורה.' }}
        input={{
          required: true,
          minLength: 2,
          maxLength: 2000,
          value: current.note,
          onChange: (e) => {
            onChoice({ decision: 'skip', note: e.currentTarget.value });
          },
        }}
      />
    </div>
  );
}

function Choices({ row, onChoice }: Pick<Props, 'row' | 'onChoice'>) {
  const name = `row-${String(row.rowId)}`;
  const current = row.choice;
  const option = (choice: Choice, label: string) => (
    <label key={keyOf(choice)} className={styles.choice}>
      <input
        type="radio"
        name={name}
        checked={keyOf(choice) === keyOf(current)}
        onChange={() => {
          onChoice(choice);
        }}
      />
      <span>{label}</span>
    </label>
  );
  return (
    <fieldset className={styles.choices}>
      <legend>מה לעשות בשורה</legend>
      {option({ decision: 'new' }, 'ספק חדש')}
      {row.candidates.map((c) =>
        option(
          { decision: 'link', target: c.id },
          `שיוך ל${c.name} (${MATCH_LABELS[c.match_rank] ?? 'מועמד'})`,
        ),
      )}
      {option({ decision: 'hold' }, 'להשאיר לבדיקה')}
      {option({ decision: 'skip', note: '' }, 'דילוג')}
      <SkipNote current={current} onChoice={onChoice} />
    </fieldset>
  );
}

function Corrections({ row, onEdit }: Pick<Props, 'row' | 'onEdit'>) {
  return (
    <details>
      <summary>תיקון ערכים בטיוטה</summary>
      <div className={styles.fields}>
        {EDITABLE.map((field) => (
          <FormField
            key={field}
            field={{ label: HEADERS[field] }}
            input={{
              value: row.edited[field] ?? '',
              onChange: (e) => {
                onEdit({ ...row.edited, [field]: e.currentTarget.value });
              },
            }}
          />
        ))}
      </div>
    </details>
  );
}

function Values({ edited }: { edited: Edited }) {
  const shown = SHOWN.filter((field) => field !== 'note' && edited[field]);
  if (shown.length === 0) return null;
  return (
    <dl className={styles.values}>
      {shown.map((field) => (
        <div key={field}>
          <dt>{HEADERS[field]}</dt>
          <dd>
            <bdi>{field === 'note' ? '' : edited[field]}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One source row: what was read, what is wrong, the candidates and the decision (6.4, 6.5). */
export function RowCard({ row, existing, onChoice, onEdit }: Props) {
  const label = `שורה ${String(row.rowNumber)}`;
  return (
    <li
      className={styles.card}
      aria-label={label}
      data-issues={row.issues.length > 0 ? '' : undefined}
    >
      <div className={styles.cardHead}>
        <strong>
          <span className={styles.rowNumber}>{label}</span>
          <bdi>{[row.edited.name, 'בלי שם'].find(Boolean)}</bdi>
        </strong>
        <span className={styles.badge} data-tone={row.choice.decision}>
          {BADGES[row.choice.decision]}
        </span>
      </div>
      <Values edited={row.edited} />
      {row.issues.length > 0 && (
        <ul className={styles.issues} aria-label="מה חסר או לא תקין">
          {row.issues.map((issue, i) => (
            <li key={i}>{`${HEADERS[issue.field]}: ${issue.text}`}</li>
          ))}
        </ul>
      )}
      <Choices row={row} onChoice={onChoice} />
      {row.choice.decision === 'link' && existing && <Compare row={row} existing={existing} />}
      <Corrections row={row} onEdit={onEdit} />
    </li>
  );
}

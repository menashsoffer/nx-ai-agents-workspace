import { useActionState, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { autoMapping, FIELDS, HEADERS, isTemplate, type Field } from '../model/columns.ts';
import type { OpenedFile } from '../model/read.ts';
import { MAX_ROWS, stagedRows, tableOf, type StagedRow, type Table } from '../model/rows.ts';
import styles from './import.module.css';

interface Props {
  file: OpenedFile;
  onSave: (rows: StagedRow[]) => Promise<string>;
  onBack: () => void;
}

const fieldOptions = [
  <option key="" value="">
    לא נקלט (נשמר רק בשורת המקור)
  </option>,
  ...FIELDS.map((field) => (
    <option key={field} value={field}>
      {HEADERS[field]}
    </option>
  )),
];

/** The first five rows as read, so numbers and dates can be checked before saving (6.2). */
function Sample({ table }: { table: Table }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.compare} aria-label="חמש השורות הראשונות כפי שנקראו">
        <thead>
          <tr>
            <th scope="col">שורה</th>
            {table.headers.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, 5).map((row) => (
            <tr key={row.number}>
              <th scope="row">{row.number}</th>
              {table.headers.map((_, i) => (
                <td key={i}>
                  <bdi>{row.cells[i] ?? ''}</bdi>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Columns({
  table,
  mapping,
  onChange,
}: {
  table: Table;
  mapping: (Field | null)[];
  onChange: (index: number, field: Field | null) => void;
}) {
  return (
    <fieldset className={styles.mapping}>
      <legend>לאיזה שדה נכנסת כל עמודה</legend>
      {table.headers.map((header, i) => (
        <SelectField
          key={`${header}-${String(i)}`}
          field={{ label: header }}
          select={{
            value: mapping[i] ?? '',
            onChange: (e) => {
              onChange(i, (e.currentTarget.value || null) as Field | null);
            },
            children: fieldOptions,
          }}
        />
      ))}
    </fieldset>
  );
}

function tableProblem(table: Table, mapping: readonly (Field | null)[]): string {
  if (table.rows.length === 0) return 'בגיליון הזה אין שורות נתונים מתחת לכותרות.';
  if (table.rows.length > MAX_ROWS) return 'יש יותר מ-5,000 שורות. צריך לפצל את הקובץ.';
  if (!mapping.includes('name')) return 'צריך לבחור איזו עמודה היא שם הספק.';
  return '';
}

function SheetPicker({
  file,
  index,
  onPick,
}: {
  file: OpenedFile;
  index: number;
  onPick: (index: number) => void;
}) {
  if (file.sheets.length < 2) return null;
  return (
    <SelectField
      field={{ label: 'גיליון' }}
      select={{
        value: String(index),
        onChange: (e) => {
          onPick(Number(e.currentTarget.value));
        },
        children: file.sheets.map((s, i) => (
          <option key={s.name} value={i}>
            {s.name}
          </option>
        )),
      }}
    />
  );
}

/** Step 2 (spec 6.2): match columns by header; a template file is matched already. */
export function MappingStep({ file, onSave, onBack }: Props) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const table = tableOf(file.sheets[sheetIndex]?.rows ?? []);
  const [mapping, setMapping] = useState(() => autoMapping(table.headers));
  const [error, save, saving] = useActionState(async () => {
    const problem = tableProblem(table, mapping);
    return problem || onSave(stagedRows(table, mapping));
  }, '');
  function pickSheet(index: number) {
    setSheetIndex(index);
    setMapping(autoMapping(tableOf(file.sheets[index]?.rows ?? []).headers));
  }
  const template = isTemplate(table.headers);
  return (
    <form action={save} className={styles.panel} aria-labelledby="import-mapping">
      <h2 id="import-mapping">התאמת עמודות</h2>
      <p className={styles.muted}>
        <bdi>{file.name}</bdi>
        {`: ${table.rows.length.toLocaleString('he-IL')} שורות.`}
        {template && ' הקובץ בנוי לפי התבנית, והעמודות הותאמו מעצמן.'}
      </p>
      {error && <Notice tone="error" title={error} />}
      <SheetPicker file={file} index={sheetIndex} onPick={pickSheet} />
      {!template && (
        <Columns
          table={table}
          mapping={mapping}
          onChange={(i, field) => {
            setMapping((m) => m.map((f, j) => (j === i ? field : f)));
          }}
        />
      )}
      <Sample table={table} />
      <FormActions>
        <Button type="submit" pending={saving} pendingLabel="שומר טיוטה…">
          שמירת טיוטה
        </Button>
        <Button variant="secondary" onClick={onBack}>
          קובץ אחר
        </Button>
      </FormActions>
    </form>
  );
}

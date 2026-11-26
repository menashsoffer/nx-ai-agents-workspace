import { useActionState, useEffect, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { loadExisting, type Existing } from '../api/existing.ts';
import { matches, summarize, type Filter, type ReviewRow } from '../model/decisions.ts';
import { RowCard } from './row-card.tsx';
import styles from './import.module.css';

const PAGE = 100;

const FILTERS: Record<Filter, string> = {
  all: 'כל השורות',
  issues: 'שורות עם חוסרים או שגיאות',
  candidates: 'שורות עם מועמד התאמה',
  hold: 'שורות שנשארות לבדיקה',
};

interface Props {
  rows: ReviewRow[];
  onRows: (rows: ReviewRow[]) => void;
  onApprove: () => Promise<string>;
}

/** Existing values of every candidate, loaded once so a comparison opens at once. */
function useExisting(rows: readonly ReviewRow[]): Map<string, Existing> {
  const [existing, setExisting] = useState(new Map<string, Existing>());
  const ids = rows.flatMap((row) => row.candidates.map((c) => c.id)).join(',');
  useEffect(() => {
    if (!ids) return;
    let live = true;
    loadExisting(ids.split(','))
      .then((found) => {
        if (live) setExisting(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ids]);
  return existing;
}

function Summary({ rows }: { rows: readonly ReviewRow[] }) {
  const counts = summarize(rows.map((row) => row.choice));
  const items = [
    ['ספקים חדשים', counts.new],
    ['תוספות לספקים קיימים', counts.link],
    ['דילוג', counts.skip],
    ['נשארות לבדיקה', counts.hold],
  ] as const;
  return (
    <ul className={styles.summary} aria-label="סיכום לפני אישור">
      {items.map(([label, count]) => (
        <li key={label}>
          <strong>{count.toLocaleString('he-IL')}</strong> {label}
        </li>
      ))}
    </ul>
  );
}

function skipWithoutNote(rows: readonly ReviewRow[]): ReviewRow | undefined {
  return rows.find((r) => r.choice.decision === 'skip' && r.choice.note.trim().length < 2);
}

function More({ left, onMore }: { left: number; onMore: () => void }) {
  if (left <= 0) return null;
  return (
    <Button variant="secondary" onClick={onMore}>
      {`עוד ${String(Math.min(PAGE, left))} שורות`}
    </Button>
  );
}

function RowList({ rows, onRows }: Pick<Props, 'rows' | 'onRows'>) {
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const existing = useExisting(rows);
  const visible = rows.filter((row) => matches(row, filter));
  const update = (rowId: number, change: Partial<ReviewRow>) => {
    onRows(rows.map((row) => (row.rowId === rowId ? { ...row, ...change } : row)));
  };
  return (
    <>
      <div className={styles.toolbar}>
        <SelectField
          field={{ label: 'הצגה' }}
          select={{
            value: filter,
            onChange: (e) => {
              setFilter(e.currentTarget.value as Filter);
            },
            children: Object.entries(FILTERS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            )),
          }}
        />
      </div>
      <ul className={styles.list} aria-label={`שורות (${String(visible.length)})`}>
        {visible.slice(0, shown).map((row) => (
          <RowCard
            key={row.rowId}
            row={row}
            existing={row.choice.decision === 'link' ? existing.get(row.choice.target) : undefined}
            onChoice={(choice) => {
              update(row.rowId, { choice });
            }}
            onEdit={(edited) => {
              update(row.rowId, { edited });
            }}
          />
        ))}
      </ul>
      <More
        left={visible.length - shown}
        onMore={() => {
          setShown((n) => n + PAGE);
        }}
      />
    </>
  );
}

function ApproveForm({ rows, onApprove }: Pick<Props, 'rows' | 'onApprove'>) {
  const [error, approve, saving] = useActionState(async () => {
    const missing = skipWithoutNote(rows);
    if (missing) return `בשורה ${String(missing.rowNumber)} חסרה סיבת דילוג.`;
    return onApprove();
  }, '');
  return (
    <form action={approve} className={styles.panel} aria-labelledby="import-approve">
      <h2 id="import-approve">אישור הקליטה</h2>
      <Summary rows={rows} />
      <p className={styles.muted}>
        קליטה אינה אישור ספק, אינה מעידה על חוזה בתוקף ואינה מאשרת מסלול התקשרות.
      </p>
      {error && <Notice tone="error" title={error} />}
      <FormActions>
        <Button type="submit" pending={saving} pendingLabel="קולט…">
          אישור וקליטה
        </Button>
      </FormActions>
    </form>
  );
}

/** Steps 4-6 (spec section 6): review, decide, and approve explicitly. */
export function ReviewStep({ rows, onRows, onApprove }: Props) {
  return (
    <section className={styles.page} aria-labelledby="import-review">
      <h2 id="import-review">בדיקת השורות</h2>
      <p className={styles.muted}>
        ההצעות לא נקלטות עד האישור. שורה שנשארת לבדיקה לא יוצרת ולא משנה דבר.
      </p>
      <RowList rows={rows} onRows={onRows} />
      <ApproveForm rows={rows} onApprove={onApprove} />
    </section>
  );
}

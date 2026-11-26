import { Link } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { importRowError } from '../model/row-error.ts';
import type { ImportRow } from '../api/import.ts';
import styles from './import.module.css';

const STATUS: Record<ImportRow['status'], string> = {
  promoted: 'נקלטה',
  rejected: 'דולגה',
  pending: 'ממתינה',
  duplicate: 'כפולה',
};
const DECISION: Record<string, string> = { new: 'ספק חדש', link: 'שיוך לקיים', hold: 'לבדיקה' };

interface Props {
  result: { promoted: number; failed: number; pending: number };
  rows: ImportRow[];
  onContinue: () => void;
}

function nameOf(row: ImportRow): string {
  const name = row.edited?.name;
  return typeof name === 'string' && name ? name : 'בלי שם';
}

function ResultTable({ rows }: { rows: ImportRow[] }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.compare} aria-label="תוצאה לכל שורה">
        <thead>
          <tr>
            <th scope="col">שורה</th>
            <th scope="col">שם</th>
            <th scope="col">החלטה</th>
            <th scope="col">מצב</th>
            <th scope="col">פרטים</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.row_number}</th>
              <td>
                <bdi>{nameOf(row)}</bdi>
              </td>
              <td>{row.decision ? (DECISION[row.decision] ?? '') : ''}</td>
              <td>{STATUS[row.status]}</td>
              <td>
                {row.status === 'promoted' && row.target_supplier_id ? (
                  <Link to={`/supplier/${row.target_supplier_id}`}>לכרטיס הספק</Link>
                ) : row.error ? (
                  importRowError(row.error)
                ) : (
                  (row.reviewer_note ?? '')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Step 7 (spec 6.7): what happened to each source row. Rows left waiting can be reopened. */
export function Results({ result, rows, onContinue }: Props) {
  return (
    <section className={styles.panel} aria-labelledby="import-results">
      <h2 id="import-results">תוצאות הקליטה</h2>
      <Notice
        tone={result.failed ? 'warning' : 'success'}
        title={`נקלטו ${String(result.promoted)} שורות. ${String(result.pending)} ממתינות.`}
      >
        {result.failed
          ? `${String(result.failed)} שורות לא נקלטו בגלל שגיאה, והן נשארו ממתינות. הסיבה כתובה בטבלה.`
          : 'שורות שנשארו ממתינות לא שינו דבר, ואפשר לחזור אליהן.'}
      </Notice>
      <ResultTable rows={rows} />
      {result.pending > 0 && (
        <Button variant="secondary" onClick={onContinue}>
          חזרה לשורות הממתינות
        </Button>
      )}
    </section>
  );
}

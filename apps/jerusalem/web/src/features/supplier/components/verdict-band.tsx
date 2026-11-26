import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { verdict, type RowState } from '../model/verdict.ts';
import styles from './verdict.module.css';

const MARKS: Record<RowState, string> = { ok: '✓', warn: '!', bad: '✕', none: '–' };
const SPOKEN: Record<RowState, string> = {
  ok: 'תקין',
  warn: 'לבדוק',
  bad: 'חוסם',
  none: 'לא נבדק',
};

/** May the municipality contract with this supplier through a registry, and until when. */
export function VerdictBand({ data, today }: { data: SupplierDetail; today: string }) {
  const result = verdict(data, today);
  return (
    <section aria-labelledby="supplier-verdict" className={styles.band} data-kind={result.kind}>
      <div className={styles.answer}>
        <span className={styles.question}>אפשר להתקשר עם הספק דרך המאגר?</span>
        <h2 id="supplier-verdict" className={styles.label}>
          {result.label}
        </h2>
        {result.summary && <p className={styles.summary}>{result.summary}</p>}
      </div>
      <ul className={styles.rows}>
        {result.rows.map((row) => (
          <li key={row.title} className={styles.row} data-state={row.state}>
            <span className={styles.mark} aria-hidden="true">
              {MARKS[row.state]}
            </span>
            <span className={styles.rowText}>
              <strong>
                <span className={styles.spoken}>{SPOKEN[row.state]}: </span>
                {row.title}
              </strong>
              <span>{row.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

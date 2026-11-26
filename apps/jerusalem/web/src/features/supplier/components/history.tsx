import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { historyDays, type HistoryDay } from '../model/history.ts';
import styles from './supplier.module.css';

const SHOWN = 10;

function Days({ days }: { days: HistoryDay[] }) {
  return days.map((day) => (
    <div key={day.date}>
      <h3>{day.date}</h3>
      <ol className={styles.timeline}>
        {day.lines.map((line) => (
          <li key={line.key}>
            <span>{line.text}</span>
            <span className={styles.muted}>
              <bdi>{line.time}</bdi>
            </span>
          </li>
        ))}
      </ol>
    </div>
  ));
}

/** Split the days so that about the first SHOWN lines stay visible. */
function split(days: HistoryDay[]): [HistoryDay[], HistoryDay[]] {
  let count = 0;
  const index = days.findIndex((day) => (count += day.lines.length) > SHOWN);
  return index < 1 ? [days, []] : [days.slice(0, index), days.slice(index)];
}

/**
 * Spec section 4.4. The server sends the log only to system administrators; for everyone else
 * `audit` is null and the section does not exist.
 */
export function History({ audit }: { audit: SupplierDetail['audit'] }) {
  if (audit === null) return null;
  const [recent, older] = split(historyDays(audit));
  return (
    <section className={[styles.card, styles.wide].join(' ')} aria-labelledby="supplier-history">
      <header className={styles.historyHead}>
        <h2 id="supplier-history">היסטוריית שינויים</h2>
        <span className={styles.badge}>גלוי למנהלי מערכת בלבד</span>
      </header>
      {audit.length === 0 && <p>לא נמצאו שינויים ביומן.</p>}
      <Days days={recent} />
      {older.length > 0 && (
        <details>
          <summary>שינויים קודמים</summary>
          <Days days={older} />
        </details>
      )}
    </section>
  );
}

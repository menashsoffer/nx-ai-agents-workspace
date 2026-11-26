import type { Totals } from '../model/summary.ts';
import { formatCount, formatDuration } from '../model/summary.ts';
import styles from './usage.module.css';

export function Stats({ totals }: { totals: Totals }) {
  const items = [
    { label: 'ביקורים', value: formatCount(totals.visits) },
    {
      label: 'משתמשים ביום',
      value: totals.dailyVisitors.toLocaleString('he-IL'),
      note: 'ממוצע; אנשים נספרים לכל יום בנפרד',
    },
    { label: 'זמן ממוצע לביקור', value: formatDuration(totals.averageVisitMs) },
    { label: 'פעולות', value: formatCount(totals.actions), note: 'לחיצות על פעולות מרכזיות' },
  ];
  return (
    <ul className={styles.stats} aria-label="סיכום">
      {items.map((item) => (
        <li key={item.label} className={styles.stat}>
          <span className={styles.value}>{item.value}</span>
          <span className={styles.label}>{item.label}</span>
          {item.note && <span className={styles.note}>{item.note}</span>}
        </li>
      ))}
    </ul>
  );
}

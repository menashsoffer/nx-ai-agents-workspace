// Visits per day as one column per day, oldest on the left. Each column names its day and
// count on hover; the same numbers are in a table under "הצגה כטבלה".
import type { DayRow } from '../model/summary.ts';
import { formatCount } from '../model/summary.ts';
import styles from './usage.module.css';

const HEIGHT = 120;
const SLOT = 12;
const BAR = 6;

export const dayName = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
});
const shortDay = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'numeric',
});
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

function Column({ row, index, max }: { row: DayRow; index: number; max: number }) {
  const height = row.visits ? Math.max(2, (row.visits / max) * (HEIGHT - 4)) : 0;
  const x = index * SLOT;
  return (
    <g className={styles.column}>
      <title>{`${dayName.format(dateOf(row.day))}: ${formatCount(row.visits)} ביקורים`}</title>
      <rect x={x} y={0} width={SLOT} height={HEIGHT} className={styles.hit} />
      <rect
        x={x + (SLOT - BAR) / 2}
        y={HEIGHT - height}
        width={BAR}
        height={height}
        className={styles.mark}
      />
    </g>
  );
}

export function DaysChart({ rows }: { rows: DayRow[] }) {
  const max = Math.max(...rows.map((r) => r.visits), 1);
  const total = rows.reduce((n, r) => n + r.visits, 0);
  const first = rows[0];
  const last = rows.at(-1);
  return (
    <figure className={styles.chart}>
      <div className={styles.plot}>
        <span className={styles.axisMax} aria-hidden="true">
          {formatCount(max)}
        </span>
        <svg
          viewBox={`0 0 ${String(rows.length * SLOT)} ${String(HEIGHT)}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${formatCount(total)} ביקורים ב-${String(rows.length)} ימים, עד ${formatCount(max)} ביום`}
        >
          <line x1={0} x2={rows.length * SLOT} y1={HEIGHT} y2={HEIGHT} className={styles.base} />
          {rows.map((row, index) => (
            <Column key={row.day} row={row} index={index} max={max} />
          ))}
        </svg>
      </div>
      {first && last && (
        <figcaption className={styles.axisDays} aria-hidden="true">
          <span>{shortDay.format(dateOf(first.day))}</span>
          <span>{shortDay.format(dateOf(last.day))}</span>
        </figcaption>
      )}
    </figure>
  );
}

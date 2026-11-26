import { Link } from 'react-router';
import type { LoadControl } from '../api/control.ts';
import { candidateTotal } from '../model/registries.ts';
import { sourceLabel } from '../model/labels.ts';
import styles from './control.module.css';

interface Stat {
  label: string;
  value: number;
  note?: string;
  to?: string;
}
const number = new Intl.NumberFormat('he-IL');

function stats(data: LoadControl): Stat[] {
  const sources = Object.entries(data.candidates)
    .filter(([, n]) => n > 0)
    .map(([source, n]) => `${number.format(n)} מ${sourceLabel(source)}`)
    .join(', ');
  return [
    { label: 'מזהים ממתינים', value: data.identifiers_pending, note: 'לאימות של אדם נוסף' },
    {
      label: 'מועמדים ממתינים',
      value: candidateTotal(data.candidates),
      ...(sources && { note: sources }),
      to: '/identifiers',
    },
    { label: 'שמות ספק כפולים', value: data.same_names, note: 'שם זהה אינו הוכחה לאותו ספק' },
    { label: 'מתקנים עם פרטי אולם', value: data.venues },
  ];
}

/** Four numbers first; a number that has its own screen links to it (spec 10.1). */
export function StatCards({ data }: { data: LoadControl }) {
  return (
    <ul className={styles.stats} aria-label="סיכום">
      {stats(data).map((stat) => (
        <li key={stat.label} className={styles.stat}>
          <span className={styles.value}>{number.format(stat.value)}</span>
          {stat.to ? (
            <Link to={stat.to} className={styles.label}>
              {stat.label}
            </Link>
          ) : (
            <span className={styles.label}>{stat.label}</span>
          )}
          {stat.note && <span className={styles.note}>{stat.note}</span>}
        </li>
      ))}
    </ul>
  );
}

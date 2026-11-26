import type { HomeOverview } from '../model/overview.ts';
import styles from '../home.module.css';

function number(value: number): string {
  return value.toLocaleString('he-IL');
}

/** Four numbers on the state of the registries; each card says what its number counts. */
export function RegistryState({ overview }: { overview: HomeOverview }) {
  const verified = overview.memberships
    ? Math.round((overview.memberships_verified / overview.memberships) * 100)
    : 0;
  const missing = overview.active_suppliers - overview.suppliers_identified;
  return (
    <section aria-labelledby="home-state" className={styles.state}>
      <h2 id="home-state">מצב המאגרים</h2>
      <ul className={styles.stats}>
        <li className={styles.stat}>
          <span className={styles.muted}>ספקים פעילים</span>
          <strong className={styles.number}>{number(overview.active_suppliers)}</strong>
          <span className={styles.muted}>ב-{number(overview.registries)} מאגרים</span>
        </li>
        <li className={styles.stat}>
          <span className={styles.muted}>שיוכים שנבדקו</span>
          <strong className={styles.number}>
            {number(overview.memberships_verified)}{' '}
            <span className={styles.of}>מתוך {number(overview.memberships)}</span>
          </strong>
          <meter
            className={styles.meter}
            min={0}
            max={100}
            value={verified}
            aria-label={`${String(verified)}% מהשיוכים נבדקו`}
          />
        </li>
        <li className={styles.stat}>
          <span className={styles.muted}>ספקים עם מזהה מאושר</span>
          <strong className={styles.number}>{number(overview.suppliers_identified)}</strong>
          <span className={styles.muted}>חסר ל-{number(Math.max(missing, 0))}</span>
        </li>
        <li className={styles.stat}>
          <span className={styles.muted}>בקשות התקשרות פתוחות</span>
          <strong className={styles.number}>{number(overview.my_open_requests)}</strong>
          <span className={styles.muted}>ביחידות שלך</span>
        </li>
      </ul>
    </section>
  );
}

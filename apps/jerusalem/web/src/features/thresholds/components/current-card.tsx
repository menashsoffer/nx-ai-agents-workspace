import { dayOf } from '../../../lib/dates.ts';
import type { Threshold } from '../api/proposals.ts';
import { AMOUNT_LABELS, formatMoney } from '../model/comparison.ts';
import styles from './proposal-card.module.css';

/** "הספים בתוקף היום": always first, so the screen is never empty (spec 9.1). */
export function CurrentCard({ current }: { current: Threshold | null }) {
  return (
    <section className={styles.card} aria-labelledby="current-thresholds">
      <h2 id="current-thresholds">הספים בתוקף היום</h2>
      {current ? (
        <>
          <p>
            בתוקף מ-{dayOf(current.valid_from)}{' '}
            <span className={current.is_official ? styles.official : styles.internal}>
              {current.is_official ? 'רשמי' : 'חישוב פנימי, לא פורסם רשמית'}
            </span>
          </p>
          <dl className={styles.amounts}>
            {Object.entries(AMOUNT_LABELS).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  <bdi>{formatMoney(current[key as keyof typeof AMOUNT_LABELS])}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p>אין ספים בתוקף היום. בדיקת המסלול לא תוכל לחשב סף עד שתאושר הצעה.</p>
      )}
    </section>
  );
}

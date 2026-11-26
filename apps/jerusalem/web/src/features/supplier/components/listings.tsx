import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { listings } from '../model/view.ts';
import styles from './supplier.module.css';

/**
 * Spec section 4.2: the registries and fields, the main thing staff come for. The source
 * documents are under "מאיפה המידע", not on each listing (Menash, 18.11).
 */
export function Listings({ data, today }: { data: SupplierDetail; today: string }) {
  const items = listings(data, today);
  return (
    <section className={[styles.card, styles.main].join(' ')} aria-labelledby="supplier-listings">
      <h2 id="supplier-listings">רישום במאגרים</h2>
      {items.length === 0 && <p>אין רישומים שניתן להציג.</p>}
      {items.map((item) => (
        <article key={item.key} className={styles.listing}>
          <header>
            <h3>{item.registry}</h3>
            <span className={[styles.badge, styles[item.badge.tone]].join(' ')}>
              {item.badge.text}
            </span>
          </header>
          {item.fields.length > 0 && (
            <ul className={styles.tags} aria-label="תחומים">
              {item.fields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          )}
          <p className={styles.meta}>
            <span>{item.validity}</span>
            {item.engagement && <span>{item.engagement}</span>}
          </p>
        </article>
      ))}
    </section>
  );
}

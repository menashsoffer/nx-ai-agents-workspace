import { Link } from 'react-router';
import type { Supplier } from '../../../catalog-model.ts';
import { inactiveLine, supplierFields } from '../model/card-labels.ts';
import { VenueFacts } from './venue-facts.tsx';
import styles from './catalog.module.css';
const FIELDS_SHOWN = 3;
/** What the supplier does, as quiet tags; the rest of the listings wait on the supplier screen. */
function Fields({ supplier, today }: { supplier: Supplier; today: string }) {
  const fields = supplierFields(supplier.memberships, today);
  const more = fields.length - FIELDS_SHOWN;
  return (
    <ul className={styles.fields} aria-label="תחום">
      {fields.slice(0, FIELDS_SHOWN).map((field) => (
        <li key={field}>{field}</li>
      ))}
      {more > 0 && <li className={styles.more}>ועוד {String(more)}</li>}
    </ul>
  );
}
interface Props {
  supplier: Supplier;
  today: string;
  deferred: boolean;
}
/**
 * The card is a heading: who the supplier is and what they do. The identifier, contacts and the
 * request button live on the supplier screen, one click away.
 */
export function SupplierCard({ supplier, today, deferred }: Props) {
  return (
    <li className={deferred ? styles.deferred : styles.item}>
      <article className={styles.card}>
        <header className={styles.cardHead}>
          <h3>
            <Link
              to={`/supplier/${encodeURIComponent(supplier.id)}`}
              state={{ fromCatalog: true }}
              aria-label={`פרטי ספק: ${supplier.name}`}
            >
              {supplier.name}
            </Link>
          </h3>
          {supplier.inactive && (
            <span className={[styles.badge, styles.danger].join(' ')}>לא פעיל</span>
          )}
        </header>
        {supplier.inactive && (
          <p role="note" id={`inactive-${supplier.id}`} className={styles.inactive}>
            {inactiveLine(supplier.inactive)}
          </p>
        )}
        <Fields supplier={supplier} today={today} />
        <VenueFacts venue={supplier.venue} />
      </article>
    </li>
  );
}

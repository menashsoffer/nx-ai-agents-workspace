import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { ENTITY_KINDS, ID_SOURCES, ID_TYPES, REVIEW, safeSourceUrl } from '../model/labels.ts';
import styles from './supplier.module.css';

interface Props {
  data: SupplierDetail;
}

/** Spec section 4.3: label and value pairs, with no "source not recorded" lines. */
export function IdentityCard({ data }: Props) {
  const { supplier } = data;
  return (
    <section className={styles.card} aria-labelledby="supplier-identity">
      <h2 id="supplier-identity">פרטי זיהוי</h2>
      <dl className={styles.pairs}>
        <div>
          <dt>סוג ישות</dt>
          <dd>{ENTITY_KINDS[supplier.entity_kind] ?? 'לא ידוע'}</dd>
        </div>
        {data.identifiers.map((item) => (
          <div key={item.id}>
            <dt>{ID_TYPES[item.scheme] ?? 'מזהה'}</dt>
            <dd>
              <bdi>{item.value}</bdi>{' '}
              <span className={styles.muted}>
                · {REVIEW[item.review_status] ?? 'מצב לא ידוע'}
                {ID_SOURCES[item.source] ? ` (${ID_SOURCES[item.source] ?? ''})` : ''}
              </span>
            </dd>
          </div>
        ))}
        {supplier.website && (
          <div>
            <dt>אתר</dt>
            <dd>
              <bdi>{supplier.website}</bdi>
            </dd>
          </div>
        )}
        {supplier.note && (
          <div>
            <dt>הערה</dt>
            <dd>{supplier.note}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** One line on where the facts come from, with the documents behind a disclosure. */
export function Sources({ data }: Props) {
  const ids = new Set(
    [
      ...data.names.map((item) => item.source_document_id),
      ...data.contacts.map((item) => item.source_document_id),
      ...data.memberships.map(
        (item) => data.versions.find((v) => v.id === item.registry_version_id)?.source_document_id,
      ),
    ].filter((id): id is string => typeof id === 'string'),
  );
  const links = data.documents.flatMap((item) => {
    const url = ids.has(item.id) && item.url ? safeSourceUrl(item.url) : null;
    return url ? [url] : [];
  });
  if (!links.length) return null;
  return (
    <section className={styles.card} aria-labelledby="supplier-sources">
      <h2 id="supplier-sources">מאיפה המידע</h2>
      <details>
        <summary>
          {links.length === 1 ? 'מסמך מקור אחד' : `${String(links.length)} מסמכי מקור`} שפורסמו באתר
          העירייה
        </summary>
        <ul>
          {links.map((url, index) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                מסמך מקור {String(index + 1)}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

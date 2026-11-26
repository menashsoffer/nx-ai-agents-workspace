import { HEADERS } from '../model/columns.ts';
import type { ReviewRow } from '../model/decisions.ts';
import type { Existing } from '../api/existing.ts';
import styles from './import.module.css';

const CONTACT_KINDS = ['phone', 'email', 'address', 'contact_person'] as const;

/** Existing and new values side by side; a different value is added next to the existing one
 * and never replaces it (spec section 8). */
export function Compare({ row, existing }: { row: ReviewRow; existing: Existing }) {
  const contact = (kind: string) =>
    existing.contacts
      .filter((c) => c.kind === kind)
      .map((c) => c.value)
      .join(' · ');
  const lines = [
    ['name', existing.name, row.edited.name] as const,
    ['website', existing.website ?? '', row.edited.website] as const,
    ...CONTACT_KINDS.map((kind) => [kind, contact(kind), row.edited[kind]] as const),
  ].filter(([, , next]) => next);
  return (
    <div className={styles.scroll}>
      <table className={styles.compare} aria-label={`השוואה לספק ${existing.name}`}>
        <thead>
          <tr>
            <th scope="col">שדה</th>
            <th scope="col">קיים אצל הספק</th>
            <th scope="col">מהקובץ</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(([field, before, next]) => (
            <tr key={field}>
              <th scope="row">{HEADERS[field]}</th>
              <td>
                <bdi>{before || '—'}</bdi>
              </td>
              <td>
                <bdi>{next}</bdi>
                {before && before !== next && (
                  <span className={styles.added}>יתווסף לצד הקיים</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

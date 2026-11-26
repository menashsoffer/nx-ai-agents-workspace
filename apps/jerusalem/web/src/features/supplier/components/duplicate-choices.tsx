import { Notice } from '../../../ui/notice.tsx';
import type { Candidate } from '../model/duplicates.ts';
import { OFFERED_FIELD } from '../model/add-form.ts';
import styles from './supplier.module.css';

/**
 * Similar names are a hint, not proof of the same supplier, so the user decides: an existing
 * supplier, or a new one anyway. The choice is required whenever it is shown (spec 3.2).
 */
export function DuplicateChoices({ candidates }: { candidates: Candidate[] }) {
  if (candidates.length === 0) return null;
  return (
    <fieldset className={styles.group}>
      <legend>ספקים דומים</legend>
      <Notice tone="warning" title="נמצאו ספקים דומים במאגרים.">
        אם זה אחד מהם, בחרו אותו. אחרת בחרו "זה ספק חדש".
      </Notice>
      {/* Tells the form handler that a choice was offered, so an empty choice is refused. */}
      <input type="hidden" name={OFFERED_FIELD} value="1" />
      <div className={styles.choices}>
        {candidates.map((item) => (
          <label key={item.id} className={styles.choice}>
            <input type="radio" name="supplier_choice" value={item.id} required />
            <span>
              <strong>{item.name}</strong>
              <span className={styles.choiceMeta}>
                {item.registries.join(' · ') || 'לא רשום במאגר'}
              </span>
              {item.identifierMatch && <span className={styles.match}>מזהה זהה</span>}
            </span>
          </label>
        ))}
        <label className={styles.choice}>
          <input type="radio" name="supplier_choice" value="new" required />
          <strong>זה ספק חדש</strong>
        </label>
      </div>
    </fieldset>
  );
}

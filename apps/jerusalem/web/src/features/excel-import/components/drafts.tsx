import { Button } from '../../../ui/button.tsx';
import { dayOf } from '../../../lib/dates.ts';
import type { Batch } from '../api/import.ts';
import styles from './import.module.css';

interface Props {
  drafts: Batch[];
  onOpen: (batchId: string) => void;
}

/** Saved drafts that still have rows waiting: the browser may be closed between steps (6.3). */
export function Drafts({ drafts, onOpen }: Props) {
  if (drafts.length === 0) return null;
  return (
    <section className={styles.panel} aria-labelledby="import-drafts">
      <h2 id="import-drafts">טיוטות שמורות</h2>
      <ul className={styles.list} aria-label="טיוטות">
        {drafts.map((draft) => (
          <li key={draft.id} className={styles.draft}>
            <span>{`${dayOf(draft.created_at)} · ${String(draft.row_count)} שורות`}</span>
            <Button
              variant="quiet"
              onClick={() => {
                onOpen(draft.id);
              }}
            >
              המשך הטיוטה
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

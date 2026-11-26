import { Button } from '../../../ui/button.tsx';
import styles from './route-check.module.css';
import { approachLabel, type PickedSupplier } from '../model/engagement.ts';

interface Props {
  suppliers: readonly PickedSupplier[];
  remove: (id: string) => void;
}

export function PickedList({ suppliers, remove }: Props) {
  return (
    <ul aria-label="ספקים בבקשה" className={styles.picked}>
      {suppliers.map((supplier) => (
        <li key={supplier.id}>
          <span>
            <strong>{supplier.name}</strong>
            <br />
            <span className={styles.pickedMeta}>
              {supplier.inactive && (
                <span className={styles.blocked}>לא פעיל, לא ניתן לפנות אליו · </span>
              )}
              {approachLabel(supplier.lastApproached)} ·{' '}
              {supplier.emails.length ? 'יש דוא״ל' : 'אין דוא״ל במאגר'}
            </span>
          </span>
          <Button
            variant="quiet"
            aria-label={`הסרה מהבקשה: ${supplier.name}`}
            onClick={() => {
              remove(supplier.id);
            }}
          >
            הסרה
          </Button>
        </li>
      ))}
    </ul>
  );
}

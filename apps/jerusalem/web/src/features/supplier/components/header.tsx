import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { Button } from '../../../ui/button.tsx';
import { SHORTLIST_MAX, toggleShortlist, useShortlist } from '../../../lib/shortlist.ts';
import {
  alsoKnownAs,
  headerBadges,
  summaryParts,
  verificationMark,
  verificationNote,
} from '../model/view.ts';
import { EDIT_DIALOG } from './edit-dialog.tsx';
import { VerificationMark } from './verification-mark.tsx';
import styles from './supplier.module.css';

interface Props {
  data: SupplierDetail;
  editor: boolean;
}

function PickButton({ supplier }: { supplier: SupplierDetail['supplier'] }) {
  const list = useShortlist();
  const picked = list.includes(supplier.id);
  const full = !picked && list.length >= SHORTLIST_MAX;
  const blocked = supplier.status === 'inactive' && !picked;
  return (
    <Button
      disabled={full || blocked}
      onClick={() => {
        toggleShortlist(supplier.id);
      }}
    >
      {picked ? 'בבקשה, להסרה' : 'הוספה לבקשת התקשרות'}
    </Button>
  );
}

function Notice({ supplier, note }: { supplier: SupplierDetail['supplier']; note: string | null }) {
  if (supplier.status === 'inactive') {
    const parts = [
      'הספק אינו פעיל',
      supplier.status_reason && `סיבה: ${supplier.status_reason}`,
      supplier.status_source && `מקור: ${supplier.status_source}`,
    ];
    return (
      <p role="note" className={styles.alert}>
        {parts.filter(Boolean).join('. ')}.
      </p>
    );
  }
  return note ? (
    <p role="note" className={styles.info}>
      {note}
    </p>
  ) : null;
}

/**
 * Spec section 4.1: who the supplier is, its state, and the actions, in one card. Layout
 * (Menash, 18.11): status and verification mark on one line, the name centered below,
 * then the two actions side by side.
 */
export function SupplierHeader({ data, editor }: Props) {
  const { supplier } = data;
  const others = alsoKnownAs(supplier.display_name, data.names);
  return (
    <section className={[styles.card, styles.header].join(' ')} aria-labelledby="supplier-name">
      <div className={styles.identity}>
        <div className={styles.statusRow}>
          <ul className={styles.badges} aria-label="מצב הספק">
            {headerBadges(supplier).map((badge) => (
              <li key={badge.text} className={[styles.badge, styles[badge.tone]].join(' ')}>
                {badge.text}
              </li>
            ))}
          </ul>
          <VerificationMark mark={verificationMark(supplier)} />
        </div>
        <h1 id="supplier-name" tabIndex={-1}>
          {supplier.display_name}
        </h1>
        <p className={styles.summary}>{summaryParts(data).join(' · ')}</p>
        {others.length > 0 && <p className={styles.aka}>ידוע גם בשם: {others.join(', ')}</p>}
      </div>
      <div className={styles.actions}>
        {editor && (
          <Button
            variant="secondary"
            icon="pencil"
            command={{ target: EDIT_DIALOG, action: 'show-modal' }}
          >
            עריכה
          </Button>
        )}
        <PickButton supplier={supplier} />
      </div>
      <Notice supplier={supplier} note={verificationNote(data)} />
    </section>
  );
}

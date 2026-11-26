import { useState, useSyncExternalStore } from 'react';
import type { Supplier } from '../../../catalog-model.ts';
import { StatusMessage } from '../../../ui/status-message.tsx';
import { EmptyState } from '../../../ui/empty-state.tsx';
import { createBatches, BATCH_SIZE } from '../model/batches.ts';
import { SupplierCard } from './supplier-card.tsx';
import styles from './catalog.module.css';
import { Button } from '../../../ui/button.tsx';
interface Props {
  suppliers: Supplier[];
  today: string;
  /** Clears the search and every filter, offered when nothing matches. */
  reset?: (() => void) | undefined;
}
function NoResults({ reset }: Pick<Props, 'reset'>) {
  return (
    <EmptyState title="לא נמצאו ספקים">
      <p>אפשר לשנות את החיפוש או את המסננים.</p>
      {reset && (
        <Button variant="secondary" onClick={reset} data-usage="catalog.reset">
          ניקוי החיפוש והמסננים
        </Button>
      )}
    </EmptyState>
  );
}
function ResultsHead({ shown, total }: { shown: number; total: number }) {
  return (
    <>
      <div className={styles.resultsHead}>
        <h2>
          <bdi>{total.toLocaleString('he-IL')}</bdi> ספקים
        </h2>
        <StatusMessage>
          {shown < total
            ? `מציג ${String(shown)} מתוך ${String(total)} תוצאות…`
            : 'כל התוצאות מוצגות.'}
        </StatusMessage>
      </div>
      <p className={styles.dataNote}>
        הנתונים מפרסומי העירייה וטרם אומתו במלואם. חיפושים ופעולות של משתמשים מחוברים עשויים להירשם
        לצורכי בקרה.
      </p>
    </>
  );
}
export function Results({ suppliers, today, reset }: Props) {
  const [batches] = useState(() => createBatches(suppliers.length));
  const count = useSyncExternalStore(batches.subscribe, batches.getSnapshot, batches.getSnapshot);
  if (!suppliers.length) return <NoResults reset={reset} />;
  return (
    <section aria-label="תוצאות החיפוש">
      <ResultsHead shown={count} total={suppliers.length} />
      <ul
        ref={(node) => {
          if (node) return batches.mount();
          return undefined;
        }}
        className={styles.results}
        aria-label="ספקים"
        aria-busy={count < suppliers.length}
      >
        {suppliers.slice(0, count).map((supplier, index) => (
          <SupplierCard
            key={supplier.id}
            supplier={supplier}
            today={today}
            deferred={index >= BATCH_SIZE}
          />
        ))}
      </ul>
    </section>
  );
}

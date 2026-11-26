// error-handling-spec-he.md section 4: a bar across the top while the browser is offline.
import { useSyncExternalStore } from 'react';
import { Icon } from '../ui/icon.tsx';
import styles from './offline-banner.module.css';

function subscribe(changed: () => void): () => void {
  window.addEventListener('online', changed);
  window.addEventListener('offline', changed);
  return () => {
    window.removeEventListener('online', changed);
    window.removeEventListener('offline', changed);
  };
}

/** True while the browser has a network connection; always true when rendered on a server. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** The live region stays in the page, so the change is announced when the bar appears. */
export function OfflineBanner() {
  const online = useOnline();
  return (
    <div role="status">
      {!online && (
        <p className={styles.banner}>
          <Icon name="warning" className={styles.icon} />
          אין חיבור לאינטרנט. מה שמוצג עכשיו עשוי להיות ישן, ופעולות לא יישלחו עד שהחיבור יחזור.
        </p>
      )}
    </div>
  );
}

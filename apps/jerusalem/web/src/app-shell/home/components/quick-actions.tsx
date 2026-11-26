import { Link } from 'react-router';
import type { Access } from '../../../data/access.ts';
import { permitted } from '../../../data/rpc.ts';
import { Icon } from '../../../ui/icon.tsx';
import controls from '../../../ui/control.module.css';
import styles from '../home.module.css';

/**
 * The three or four things people start from; each link only for whoever may use it. Icon and
 * text together: several share a plus or a page, so the icon alone would not say which.
 */
export function QuickActions({ access }: { access: Access }) {
  const editor = permitted(access, ['editor', 'unit_manager']);
  return (
    <section aria-labelledby="home-quick" className={[styles.panel, styles.side].join(' ')}>
      <h2 id="home-quick">פעולות מהירות</h2>
      <div className={styles.actions}>
        <Link to="/engagement" className={controls.button}>
          <Icon name="plus" />
          בקשת התקשרות חדשה
        </Link>
        <Link to="/route-check" className={controls.secondary}>
          <Icon name="check" />
          איזה הליך מתאים לסכום?
        </Link>
        {editor && (
          <Link to="/supplier/new" className={controls.secondary}>
            <Icon name="personPlus" />
            הוספת ספק למאגר
          </Link>
        )}
        <Link to="/start" className={controls.secondary}>
          <Icon name="help" />
          איך מתחילים
        </Link>
        {access.admin && (
          <Link to="/import" className={controls.secondary}>
            <Icon name="sheet" />
            קליטת ספקים מאקסל
          </Link>
        )}
      </div>
    </section>
  );
}

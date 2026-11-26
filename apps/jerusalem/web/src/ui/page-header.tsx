// The top of every screen (ui-building-blocks-spec-he.md 3 and 7): back row, title, one line
// on what the screen is for, and the screen's own action.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './icon.tsx';
import styles from './page-header.module.css';

interface Props {
  title: string;
  lead?: string;
  /** Left out on the home screens of the three areas. */
  back?: { to: string; label: string };
  action?: ReactNode;
}
export function PageHeader({ title, lead, back, action }: Props) {
  return (
    <header className={styles.header}>
      {back && (
        <Link to={back.to} className={styles.back} aria-label={back.label}>
          <Icon name="back" />
          <span className={styles.backLabel}>{back.label}</span>
        </Link>
      )}
      <div className={styles.titleRow}>
        <div>
          <h1 tabIndex={-1}>{title}</h1>
          {lead && <p className={styles.lead}>{lead}</p>}
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </header>
  );
}

// The row of form buttons (ui-building-blocks-spec-he.md 4.2): primary, secondary, quiet from
// the right; a destructive button apart on the other side; pinned to the bottom on a phone.
import type { ReactNode } from 'react';
import styles from './control.module.css';

interface Props {
  children: ReactNode;
  /** A destructive action, kept away from the primary one. */
  apart?: ReactNode;
}
export function FormActions({ children, apart }: Props) {
  return (
    <div className={styles.actions}>
      <div className={styles.actionGroup}>{children}</div>
      {apart && <div className={styles.actionGroup}>{apart}</div>}
    </div>
  );
}

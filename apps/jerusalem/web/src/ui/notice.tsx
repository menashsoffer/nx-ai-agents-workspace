// The one message component (ui-building-blocks-spec-he.md 6.1): success, error, warning, info.
import type { ReactNode } from 'react';
import { Icon } from './icon.tsx';
import styles from './notice.module.css';

export type NoticeTone = 'success' | 'error' | 'warning' | 'info';
interface Props {
  tone: NoticeTone;
  /** One bold sentence: what happened. */
  title: string;
  /** At most one more sentence: what to do now. */
  children?: ReactNode;
}
/** Errors interrupt (alert), success and warnings are announced politely, info stays quiet. */
const ROLE: Record<NoticeTone, 'alert' | 'status' | undefined> = {
  error: 'alert',
  success: 'status',
  warning: 'status',
  info: undefined,
};

export function Notice({ tone, title, children }: Props) {
  return (
    <div className={`${styles.notice ?? ''} ${styles[tone] ?? ''}`} role={ROLE[tone]}>
      <Icon name={tone} className={styles.icon} />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

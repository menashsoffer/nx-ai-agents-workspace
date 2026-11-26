import styles from './loading.module.css';

interface Props {
  /** `small` sits inside a button and takes the label's color. */
  size?: 'regular' | 'small';
}

/** The five logo colors hopping in turn. Decoration only: the text beside it says what loads. */
export function LogoDots({ size = 'regular' }: Props) {
  return (
    <span
      className={size === 'small' ? [styles.dots, styles.small].join(' ') : styles.dots}
      aria-hidden
    >
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** A whole screen that has no shape yet, such as the first screen while its code arrives. */
export function PageLoader({ label = 'טוען את המסך…' }: { label?: string }) {
  return (
    <div className={styles.page} role="status">
      <LogoDots />
      <span>{label}</span>
    </div>
  );
}

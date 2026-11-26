import { IconButton } from '../../../ui/icon-button.tsx';
import type { VerificationMark as Mark } from '../model/view.ts';
import styles from './supplier.module.css';

/**
 * A clock while the supplier waits for verification, a check badge once verified. The label is
 * the button's name for screen readers and its bubble for sighted users on hover, keyboard
 * focus or tap (DESIGN.md 6.2, status mark).
 */
export function VerificationMark({ mark }: { mark: Mark }) {
  return (
    <IconButton
      icon={mark.verified ? 'verified' : 'clock'}
      label={mark.label}
      className={[styles.markButton, mark.verified ? styles.verified : styles.pending].join(' ')}
    />
  );
}

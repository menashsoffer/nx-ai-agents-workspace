import { StatusMessage } from '../../../ui/status-message.tsx';
import styles from './supplier.module.css';

interface Props {
  pending: boolean;
  /** Read out while saving; the saving button already shows it, so it is not drawn twice. */
  saving: string;
  message?: string;
}

/** The form's live region: one visible saving state (the button), the outcome once. */
export function SaveStatus({ pending, saving, message = '' }: Props) {
  return (
    <div className={pending ? styles.visuallyHidden : undefined}>
      <StatusMessage>{pending ? saving : message}</StatusMessage>
    </div>
  );
}

import { useRef, useState } from 'react';
import { IconButton } from '../../../ui/icon-button.tsx';
import styles from './supplier.module.css';

/**
 * Copies one contact value. The result shows in the button's bubble and is announced by a
 * separate live region; the button is never disabled, so a retry is always possible.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  async function copy() {
    clearTimeout(timer.current);
    setMessage('');
    let text = 'הועתק';
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      text = 'ההעתקה נכשלה';
    }
    requestAnimationFrame(() => {
      setMessage(text);
    });
    timer.current = setTimeout(() => {
      setMessage('');
    }, 2000);
  }
  return (
    <>
      <IconButton
        icon={message === 'הועתק' ? 'check' : 'copy'}
        label={`העתקת ${label}`}
        data-usage="supplier.copy"
        note={message || undefined}
        onClick={() => {
          void copy();
        }}
      />
      <span role="status" className={styles.visuallyHidden}>
        {message}
      </span>
    </>
  );
}

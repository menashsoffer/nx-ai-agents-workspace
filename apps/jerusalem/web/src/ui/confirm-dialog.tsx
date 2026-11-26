// Asks before an action that is hard to undo (ui-building-blocks-spec-he.md 6.2): a title that
// says what will happen, one sentence on the result, Cancel (focused) and the red action.
import { useId, useState, type ReactNode } from 'react';
import { Button } from './button.tsx';
import { Notice } from './notice.tsx';
import styles from './panel.module.css';

interface Props {
  id: string;
  /** What will happen, as a question: "להסיר את התפקיד 'עורך' מדנה כהן?" */
  title: string;
  children: ReactNode;
  /** `run` resolves to an error message, or '' when the action succeeded. */
  action: { label: string; run: () => Promise<string> };
}
export function ConfirmDialog({ id, title, children, action }: Props) {
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function confirm(dialog: HTMLDialogElement | null) {
    setPending(true);
    setError('');
    const message = await action.run().catch(() => 'הפעולה לא הושלמה. נסו שוב.');
    setPending(false);
    if (message) setError(message);
    else dialog?.close();
  }
  return (
    <dialog
      id={id}
      aria-labelledby={titleId}
      className={styles.dialog}
      closedby={pending ? 'none' : 'any'}
      onClose={() => {
        setError('');
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div>{children}</div>
      {error && <Notice tone="error" title={error} />}
      <div className={styles.confirmButtons}>
        {/* The safe choice gets the focus in a destructive confirmation. */}
        {/* eslint-disable-next-line jsx-a11y-x/no-autofocus */}
        <Button variant="quiet" command={{ target: id, action: 'close' }} autoFocus>
          ביטול
        </Button>
        <Button
          variant="danger"
          pending={pending}
          pendingLabel="מבצע…"
          onClick={(event) => {
            void confirm(event.currentTarget.closest('dialog'));
          }}
        >
          {action.label}
        </Button>
      </div>
    </dialog>
  );
}

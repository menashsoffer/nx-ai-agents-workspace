import { useId, useState, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';
import { onBackdrop } from '../lib/dialogs.ts';
import { Button } from './button.tsx';
import { IconButton } from './icon-button.tsx';
import styles from './panel.module.css';

interface Props {
  id: string;
  title: string;
  children: ReactNode;
  onClose?: () => void;
  /** Unsaved changes: closing asks first instead of throwing them away (spec 6.2). */
  dirty?: boolean;
}

const lightDismissIsNative = () =>
  typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

/**
 * A modal dialog that closes with the X in its corner, Escape, or a click on the backdrop
 * (closedby="any"; browsers without it get the same behaviour from the click handler).
 * With unsaved changes it is closed only by the user's explicit choice (closedby="none").
 */
/** Closing paths that ask first while there are unsaved changes. */
function useCloseGuard(dirty: boolean, onClose: (() => void) | undefined) {
  const [asking, setAsking] = useState(false);
  function leave(dialog: HTMLDialogElement) {
    if (dirty) setAsking(true);
    else dialog.close();
  }
  return {
    asking,
    keep: () => {
      setAsking(false);
    },
    leave,
    click: (event: MouseEvent<HTMLDialogElement>) => {
      const dialog = event.currentTarget;
      const nativeDismiss = lightDismissIsNative() && !dirty;
      if (!nativeDismiss && onBackdrop(dialog, event.nativeEvent)) leave(dialog);
    },
    cancel: (event: SyntheticEvent<HTMLDialogElement>) => {
      if (!dirty) return;
      event.preventDefault();
      setAsking(true);
    },
    closed: () => {
      setAsking(false);
      onClose?.();
    },
  };
}

export function Dialog({ id, title, children, onClose, dirty = false }: Props) {
  const titleId = useId();
  const guard = useCloseGuard(dirty, onClose);
  return (
    // The click handler only adds backdrop dismissal; Escape and the X button stay available.
    /* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events,
       jsx-a11y-x/no-noninteractive-element-interactions */
    <dialog
      id={id}
      aria-labelledby={titleId}
      className={styles.dialog}
      closedby={dirty ? 'none' : 'any'}
      onClick={guard.click}
      onCancel={guard.cancel}
      onClose={guard.closed}
    >
      <div className={styles.dialogHead}>
        <h2 id={titleId}>{title}</h2>
        {/* Native dialogs need an initial focus target when showModal opens them. */}
        {/* eslint-disable jsx-a11y-x/no-autofocus */}
        <IconButton
          icon="close"
          label="סגירה"
          onClick={(event) => {
            const dialog = event.currentTarget.closest('dialog');
            if (dialog) guard.leave(dialog);
          }}
          autoFocus
        />
        {/* eslint-enable jsx-a11y-x/no-autofocus */}
      </div>
      {children}
      {guard.asking && <DiscardQuestion id={id} onKeep={guard.keep} />}
    </dialog>
  );
}

/** Covers the bottom of the dialog, so nothing moves under the pointer (spec 6.2). */
function DiscardQuestion({ id, onKeep }: { id: string; onKeep: () => void }) {
  const questionId = useId();
  return (
    <div className={styles.discard} role="group" aria-labelledby={questionId}>
      <p id={questionId}>
        <strong>יש שינויים שלא נשמרו. לסגור בלי לשמור?</strong>
      </p>
      <div className={styles.discardButtons}>
        {/* eslint-disable-next-line jsx-a11y-x/no-autofocus */}
        <Button variant="secondary" onClick={onKeep} autoFocus aria-describedby={questionId}>
          המשך עריכה
        </Button>
        <Button variant="quiet" command={{ target: id, action: 'close' }}>
          סגירה בלי שמירה
        </Button>
      </div>
    </div>
  );
}

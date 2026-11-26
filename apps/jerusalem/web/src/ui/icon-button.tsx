import { useState, type FocusEvent } from 'react';
import { Button, type ButtonProps } from './button.tsx';
import type { IconName } from './icon.tsx';
import styles from './icon-button.module.css';

interface Props extends Omit<ButtonProps, 'children' | 'icon' | 'variant' | 'aria-label'> {
  icon: IconName;
  /** The full name a screen reader hears, such as "עריכת הבקשה: ניקיון גנים". */
  label: string;
  /** The short name in the bubble, such as "עריכת הבקשה". Defaults to `label`. */
  tip?: string | undefined;
  /** A short result shown in the bubble instead, such as "הועתק". The caller announces it. */
  note?: string | undefined;
  variant?: 'quiet' | 'secondary';
  /** `small` only inside a dense element such as a filter tag; it keeps a 44px touch area. */
  size?: 'regular' | 'small';
  /** A sentence rather than a name: the bubble wraps instead of staying on one line. */
  long?: boolean;
}

function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Hover, keyboard focus and tap show the bubble; leaving, blur and Escape hide it. */
function useBubble() {
  const [open, setOpen] = useState(false);
  const show = () => {
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
  };
  return {
    open,
    wrap: { onPointerEnter: show, onPointerLeave: hide },
    button: {
      // A dialog that opens with the focus on its close button should not open with a bubble.
      onFocus: (event: FocusEvent<HTMLButtonElement>) => {
        if (focusVisible(event.currentTarget)) show();
      },
      onBlur: hide,
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Escape') hide();
      },
    },
    show,
  };
}

/** While saving, the name says so ("שומר…"), since the icon itself does not change. */
function spokenName(
  { pending, pendingLabel }: Pick<Props, 'pending' | 'pendingLabel'>,
  label: string,
) {
  return pending ? (pendingLabel ?? 'שומר…') : label;
}

function tipClass(long: boolean | undefined): string {
  return long ? `${styles.tip ?? ''} ${styles.long ?? ''}` : (styles.tip ?? '');
}

/**
 * An action shown only as an icon (DESIGN.md 6.2). The name is the button's aria-label, and a
 * bubble shows it on hover, keyboard focus and tap. The pointer can move onto the bubble and
 * Escape hides it (WCAG 1.4.13). The bubble repeats the name, so it is hidden from screen readers.
 */
export function IconButton({ label, tip = label, note, size = 'regular', long, ...rest }: Props) {
  const { onClick, variant = 'quiet', className = '', ...props } = rest;
  const bubble = useBubble();
  return (
    <span className={styles.wrap} {...bubble.wrap}>
      <Button
        {...props}
        {...bubble.button}
        variant={variant}
        pendingLabel=""
        aria-label={spokenName(rest, label)}
        className={`${styles.iconButton ?? ''} ${styles[size] ?? ''} ${className}`}
        onClick={(event) => {
          bubble.show();
          onClick?.(event);
        }}
      />
      <span className={tipClass(long)} aria-hidden="true" hidden={!note && !bubble.open}>
        {note ?? tip}
      </span>
    </span>
  );
}

import type { ComponentProps, MouseEvent } from 'react';
import { runCommand } from '../lib/dialogs.ts';
import { Icon, type IconName } from './icon.tsx';
import styles from './control.module.css';

/**
 * DESIGN.md 6.2. `plain` keeps the shared behaviour (type, focus ring, saving state, dialog
 * commands) and leaves the look to one of the special patterns listed there: action tile,
 * step indicator, status mark.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'plain';
export interface ButtonProps extends ComponentProps<'button'> {
  command?: { target: string; action: 'show-modal' | 'close' };
  /** ui-building-blocks-spec-he.md 4.1: danger only inside a confirm dialog. */
  variant?: ButtonVariant;
  /** A decorative icon before the label. For an icon with no label use `IconButton`. */
  icon?: IconName | undefined;
  /** While saving: `pendingLabel` replaces the label over a flowing logo stripe; another press does
   * nothing (4.4). */
  pending?: boolean;
  pendingLabel?: string;
}
const CLASS: Record<ButtonVariant, string | undefined> = {
  primary: styles.button,
  secondary: styles.secondary,
  quiet: styles.quiet,
  danger: styles.danger,
  plain: styles.plain,
};
/** The same look for a link that leads somewhere, such as "הוספת ספק" or "לאיתור ספקים". */
export function buttonClass(variant: Exclude<ButtonVariant, 'plain'> = 'primary'): string {
  return CLASS[variant] ?? '';
}
// aria-disabled keeps a saving button focusable; data-pending draws the flowing stripe.
const PENDING = { 'aria-disabled': true, 'data-pending': '' } as const;

function Label({
  icon,
  children,
}: {
  icon: IconName | undefined;
  children: ButtonProps['children'];
}) {
  if (!icon) return children;
  return (
    <>
      <Icon name={icon} />
      {children}
    </>
  );
}

/** "שומר…" over the hidden label, so the button keeps its width and its neighbours stay put. */
function Saving({ label, children }: { label: string; children: ButtonProps['children'] }) {
  return (
    <span className={styles.saving}>
      <span aria-hidden="true" className={styles.held}>
        {children}
      </span>
      <span>{label}</span>
    </span>
  );
}

function commandAttributes(command: ButtonProps['command']) {
  return command ? { commandfor: command.target, command: command.action } : {};
}

/** Retains native button semantics, including keyboard activation and dialog commands. */
export function Button({
  command,
  onClick,
  type = 'button',
  className = '',
  variant = 'primary',
  icon,
  pending = false,
  pendingLabel = 'שומר…',
  children,
  ...props
}: ButtonProps) {
  function activate(event: MouseEvent<HTMLButtonElement>): void {
    // aria-disabled keeps the button focusable; this keeps it from sending twice.
    if (pending) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
    if (!event.defaultPrevented && !('commandForElement' in HTMLButtonElement.prototype)) {
      runCommand(event.currentTarget, event.currentTarget.ownerDocument);
    }
  }
  return (
    <button
      {...props}
      {...commandAttributes(command)}
      {...(pending ? PENDING : {})}
      type={type}
      onClick={activate}
      className={`${CLASS[variant] ?? ''} ${className}`}
    >
      {pending && pendingLabel ? (
        <Saving label={pendingLabel}>
          <Label icon={icon}>{children}</Label>
        </Saving>
      ) : (
        <Label icon={icon}>{children}</Label>
      )}
    </button>
  );
}

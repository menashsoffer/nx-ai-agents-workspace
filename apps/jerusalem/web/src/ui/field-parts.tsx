// Small pieces every form shares (ui-building-blocks-spec-he.md 5.1 and 5.3).
import type { RefObject } from 'react';
import { Icon } from './icon.tsx';
import { IconButton } from './icon-button.tsx';
import styles from './control.module.css';

/** The star beside a required field's label; `required` on the control says it to readers. */
export function RequiredMark() {
  return (
    <span className={styles.required} aria-hidden="true">
      {' *'}
    </span>
  );
}

/**
 * An info icon beside a field's label (DESIGN.md 6.3). Hover, focus and tap show the text in a
 * bubble; the same text, kept off screen, describes the field and the icon for screen readers.
 */
export function FieldInfo({ id, label, text }: { id: string; label: string; text: string }) {
  return (
    <>
      <IconButton
        icon="info"
        size="small"
        long
        label={`הסבר על השדה ${label}`}
        tip={text}
        aria-describedby={id}
        className={styles.infoButton}
      />
      <span id={id} className={styles.infoText}>
        {text}
      </span>
    </>
  );
}

/** One line at the top of a form that has required fields. */
export function RequiredNote() {
  return <p className={styles.hint}>שדות עם * הם חובה.</p>;
}

/** The message under a field: what to fix, with an icon, announced politely when it appears. */
export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <span id={id} className={styles.error} aria-live="polite">
      {message && (
        <>
          <Icon name="error" className={styles.errorIcon} />
          {message}
        </>
      )}
    </span>
  );
}

export interface FieldProblem {
  id: string;
  label: string;
  message: string;
}
interface SummaryProps {
  problems: readonly FieldProblem[];
  /** The form moves focus here after a submit with errors. */
  focusRef: RefObject<HTMLHeadingElement | null>;
}
/** For forms of more than six fields: a list at the top linking to every field to fix. */
export function ErrorSummary({ problems, focusRef }: SummaryProps) {
  if (!problems.length) return null;
  return (
    <div className={styles.summary}>
      <h2 ref={focusRef} tabIndex={-1}>
        {problems.length === 1 ? 'יש לתקן שדה אחד' : `יש לתקן ${String(problems.length)} שדות`}
      </h2>
      <ul>
        {problems.map((p) => (
          <li key={p.id}>
            <a href={`#${p.id}`}>
              {p.label}: {p.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

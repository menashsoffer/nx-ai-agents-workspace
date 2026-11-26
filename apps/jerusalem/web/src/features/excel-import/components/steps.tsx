import styles from './import.module.css';

export const STEPS = { file: 'קובץ', mapping: 'עמודות', review: 'בדיקה ואישור', done: 'תוצאות' };
export type StepKey = keyof typeof STEPS;

/** Where the admin is in the import (DESIGN.md: step indicator). The steps are not links:
 * each one opens only after the one before it is done. */
export function Steps({ current }: { current: StepKey }) {
  const keys = Object.keys(STEPS) as StepKey[];
  const at = keys.indexOf(current);
  return (
    <ol aria-label="שלבי הקליטה" className={styles.steps}>
      {keys.map((key, i) => (
        <li
          key={key}
          aria-current={key === current ? 'step' : undefined}
          data-done={i < at ? '' : undefined}
        >
          {STEPS[key]}
        </li>
      ))}
    </ol>
  );
}

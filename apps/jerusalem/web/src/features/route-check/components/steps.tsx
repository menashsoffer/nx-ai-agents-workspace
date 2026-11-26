import { Button } from '../../../ui/button.tsx';
import styles from './route-check.module.css';

export const STEPS = { suppliers: 'הספקים', details: 'פרטי הבקשה', result: 'תוצאה' } as const;
export type Step = keyof typeof STEPS;

interface Props {
  current: Step;
  /** Whether a step can be opened now; the result needs a finished check. */
  reachable: (step: Step) => boolean;
  go: (step: Step) => void;
}

/**
 * The step indicator at the top of a new request (screens-spec 2.א). Each step is a button,
 * so a step that cannot be opened yet is a native disabled button: skipped by Tab and
 * announced as unavailable.
 */
export function Steps({ current, reachable, go }: Props) {
  return (
    <ol aria-label="שלבי הבקשה" className={styles.steps}>
      {(Object.keys(STEPS) as Step[]).map((key) => (
        <li key={key}>
          <Button
            variant="plain"
            aria-current={current === key ? 'step' : undefined}
            disabled={current !== key && !reachable(key)}
            onClick={() => {
              if (current !== key) go(key);
            }}
          >
            {STEPS[key]}
          </Button>
        </li>
      ))}
    </ol>
  );
}

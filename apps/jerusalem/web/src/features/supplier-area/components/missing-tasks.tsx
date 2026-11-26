import { Button } from '../../../ui/button.tsx';
import type { Task } from '../model/missing.ts';
import styles from './area.module.css';

// The site uses a hash router, so an in-page "#id" link would change the route. Focusing the
// section's heading (tabIndex -1) scrolls it into view at once and moves the keyboard there.
function goTo(target: string) {
  document.getElementById(target)?.focus();
}

/** "מה חסר לי" (spec 6.3): up to three cards, shown only when something needs a look. */
export function MissingTasks({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  return (
    <section className={styles.panel} aria-labelledby="missing-title">
      <h2 id="missing-title">מה חסר לי</h2>
      <ul className={styles.tasks}>
        {tasks.map((task) => (
          <li key={task.key}>
            <span>{task.text}</span>
            <Button
              variant="secondary"
              onClick={() => {
                goTo(task.target);
              }}
            >
              מעבר
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

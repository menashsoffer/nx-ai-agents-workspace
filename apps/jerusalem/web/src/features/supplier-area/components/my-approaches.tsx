// "פניות" (supplier-approaches-spec-he.md 5.1): what the municipality asked, in three groups.
// The supplier sees the subject, the unit and the dates, never the estimate or the others.
import { useActionState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { withdrawAnswer, type Approach } from '../api/approaches.ts';
import {
  currentAnswer,
  dueText,
  GROUP_TITLES,
  grouped,
  shortDay,
  stateText,
  type ApproachGroup,
} from '../model/approaches.ts';
import { DeclineDialog, OfferDialog } from './answer-dialogs.tsx';
import styles from './area.module.css';

function Withdraw({ approach }: { approach: Approach }) {
  const { revalidate } = useRevalidator();
  const [error, action, pending] = useActionState(async () => {
    const answer = currentAnswer(approach);
    if (!answer) return '';
    try {
      await withdrawAnswer(answer.id);
    } catch (failure) {
      return errorText(failure);
    }
    await revalidate();
    return '';
  }, '');
  const verb = currentAnswer(approach)?.answer === 'offer' ? 'ביטול ההצעה' : 'ביטול התשובה';
  return (
    <form action={action} aria-label={`${verb}: ${approach.subject}`}>
      {error && <Notice tone="error" title={error} />}
      <Button type="submit" variant="quiet" pending={pending} pendingLabel="מבטל…">
        {verb}
      </Button>
    </form>
  );
}

interface RowProps {
  approach: Approach;
  group: ApproachGroup;
  supplierId: string;
  today: string;
}

function Row({ approach, group, supplierId, today }: RowProps) {
  const due = dueText(approach.respond_by, today);
  const waiting = group === 'waiting';
  return (
    <li data-state={waiting && due.urgent ? 'soon' : undefined}>
      <strong>{approach.subject}</strong>
      <span className={styles.muted}>
        {` · ${approach.unit_name} · פנו ב-${shortDay(approach.approached_on)}`}
        {approach.needed_by && ` · נדרש עד ${shortDay(approach.needed_by)}`}
      </span>
      <span className={styles.until}>
        {waiting ? `${due.text} (עד ${shortDay(approach.respond_by)})` : stateText(approach)}
      </span>
      {waiting && <OfferDialog supplierId={supplierId} approach={approach} />}
      {waiting && <DeclineDialog approach={approach} />}
      {group === 'answered' && approach.open && <Withdraw approach={approach} />}
    </li>
  );
}

interface Props {
  supplierId: string;
  approaches: Approach[];
  today: string;
}

export function MyApproaches({ supplierId, approaches, today }: Props) {
  const groups = grouped(approaches);
  return (
    <section className={styles.panel} aria-labelledby="approaches-title">
      <h2 id="approaches-title" tabIndex={-1}>
        פניות
      </h2>
      {approaches.length === 0 && <p>אין פניות. כשיחידה בעירייה תפנה אליכם, הפנייה תופיע כאן.</p>}
      {(Object.keys(groups) as ApproachGroup[])
        .filter((group) => groups[group].length > 0)
        .map((group) => (
          <section key={group} aria-label={GROUP_TITLES[group]}>
            <h3>{GROUP_TITLES[group]}</h3>
            <ul className={styles.list}>
              {groups[group].map((approach) => (
                <Row
                  key={approach.id}
                  approach={approach}
                  group={group}
                  supplierId={supplierId}
                  today={today}
                />
              ))}
            </ul>
          </section>
        ))}
      <p className={styles.muted}>
        העירייה רואה את סכום ההצעה ואת הקובץ רק אחרי המועד. עד אז אפשר לבטל ולהגיש מחדש. ההצעה לא
        מחליפה דרך הגשה אחרת שנקבעה בפנייה.
      </p>
    </section>
  );
}

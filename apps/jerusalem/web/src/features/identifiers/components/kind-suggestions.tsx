import { useActionState, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { EmptyState } from '../../../ui/empty-state.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { decideKind, INITIAL_KIND, suggestKinds } from '../api/kinds.ts';
import { kindLabel, reasonText, STRENGTHS, type KindSuggestion } from '../model/kinds.ts';
import styles from './candidate.module.css';

const PAGE = 25;

export interface KindRow {
  suggestion: KindSuggestion;
  supplier: string;
}

function Decision({ id, supplier }: { id: string; supplier: string }) {
  const [result, action, pending] = useActionState(
    (_: typeof INITIAL_KIND, form: FormData) => decideKind(id, form),
    INITIAL_KIND,
  );
  // Only the pressed button says "שומר…"; the other one waits, disabled (25.11.2026).
  const [pressed, setPressed] = useState('');
  const press = (event: { currentTarget: HTMLButtonElement }) => {
    setPressed(event.currentTarget.value);
  };
  return (
    <form action={action} aria-label={`החלטה על הסוג של ${supplier}`} className={styles.actions}>
      <Button
        name="decision"
        value="accept"
        type="submit"
        onClick={press}
        pending={pending && pressed === 'accept'}
        disabled={result.committed || (pending && pressed !== 'accept')}
      >
        קבלת הסוג
      </Button>
      <Button
        name="decision"
        value="reject"
        type="submit"
        variant="secondary"
        onClick={press}
        pending={pending && pressed === 'reject'}
        disabled={result.committed || (pending && pressed !== 'reject')}
      >
        דחיית ההצעה
      </Button>
      {result.message && <Notice tone="success" title={result.message} />}
      {result.error && <Notice tone="error" title={result.error} />}
    </form>
  );
}

function Row({ suggestion, supplier }: KindRow) {
  const strong = suggestion.strength === 'strong';
  return (
    <details className={styles.row}>
      <summary>
        <strong>{supplier}</strong>
        <span className={styles.meta}>
          <span>{kindLabel(suggestion.suggested_kind)}</span>
          <span className={`${styles.tag ?? ''} ${(strong ? styles.same : styles.similar) ?? ''}`}>
            {STRENGTHS[suggestion.strength]}
          </span>
        </span>
      </summary>
      <ul className={styles.hint}>
        {suggestion.reasons.map((reason, index) => (
          <li key={index}>{reasonText(reason)}</li>
        ))}
      </ul>
      <Decision id={suggestion.id} supplier={supplier} />
    </details>
  );
}

function Run() {
  const [result, action, pending] = useActionState(suggestKinds, INITIAL_KIND);
  return (
    <form action={action} className={styles.actions}>
      <Button type="submit" variant="secondary" pending={pending}>
        הצעת סוג לספקים שהסוג שלהם לא ידוע
      </Button>
      {result.message && <Notice tone="success" title={result.message} />}
      {result.error && <Notice tone="error" title={result.error} />}
    </form>
  );
}

/** Kind suggestions (supplier-edit-checks-spec, 3): hints with reasons, decided by a person. */
export function KindSuggestions({ rows }: { rows: KindRow[] }) {
  const [pages, setPages] = useState(1);
  return (
    <section aria-labelledby="kinds-title" className={styles.page}>
      <h2 id="kinds-title">הצעות סוג ישות ({String(rows.length)})</h2>
      <Notice
        tone="info"
        title="הצעה היא רמז בלבד. קבלה שולחת שינוי סוג רגיל, שעובר את הבדיקות ואת האישורים."
      />
      <Run />
      {rows.length ? (
        <div className={styles.list}>
          {rows.slice(0, pages * PAGE).map((row) => (
            <Row key={row.suggestion.id} {...row} />
          ))}
        </div>
      ) : (
        <EmptyState title="אין הצעות סוג ממתינות" />
      )}
      {rows.length > pages * PAGE && (
        <Button
          variant="secondary"
          className={styles.more}
          onClick={() => {
            setPages((n) => n + 1);
          }}
        >
          הצגת 25 נוספות
        </Button>
      )}
    </section>
  );
}

// Editing a saved request in the same details form as a new one (owner's request, 18.11):
// the form opens filled, saving stores the changes and checks the request again.
import { useEffect, useRef, useState } from 'react';
import type { SavedRequest } from '../api/saved.ts';
import { savedEntry, type Entry } from '../model/entry.ts';
import type { CheckResult } from '../model/result.ts';
import { DraftForm } from './draft-form.tsx';
import { ResultPanel } from './result-panel.tsx';
import styles from './route-check.module.css';

interface Props {
  request: SavedRequest;
  units: { id: string; name: string }[];
  today: string;
  close: () => void;
}

export function RequestEditor({ request, units, today, close }: Props) {
  const [entry, setEntry] = useState<Entry>(() => savedEntry(request));
  const [result, setResult] = useState<CheckResult | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section aria-labelledby="edit-request" className={styles.panel}>
      <h2 id="edit-request" tabIndex={-1} ref={heading}>
        עריכת הבקשה: {request.subject}
      </h2>
      <p className={styles.summary}>
        בדיקות קודמות נשמרות כפי שהיו. השמירה בודקת את הבקשה שוב לפי הפרטים החדשים.
      </p>
      <DraftForm
        units={units}
        today={today}
        entry={entry}
        keep={setEntry}
        back={close}
        backLabel="סגירת העריכה"
        complete={setResult}
      />
      {result && <ResultPanel result={result} />}
    </section>
  );
}

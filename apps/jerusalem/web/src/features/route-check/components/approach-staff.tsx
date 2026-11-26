// Staff actions on a request's approaches (supplier-approaches-spec-he.md 6.2, 6.3): recording
// an answer that came by email, phone or letter, and moving every open deadline forward.
import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { errorText } from '../../../data/errors.ts';
import { extendDeadline, recordAnswer, type RequestApproach } from '../api/approaches.ts';
import {
  amountProblem,
  cleanAmount,
  DECLINE_LABELS,
  receivedRange,
  shortDay,
} from '../model/approaches.ts';
import styles from './route-check.module.css';

interface Done {
  /** Closes the form with the status line to show. */
  done: (message: string) => void;
  cancel: () => void;
}

/** Runs a save; returns the refusal in words, or '' once it is done. */
async function attempt(save: () => Promise<string>, done: (message: string) => void) {
  try {
    done(await save());
    return '';
  } catch (cause) {
    return errorText(cause);
  }
}

/** Moves focus into a form that has just opened under the table. */
function useFocusFirst() {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, []);
  return ref;
}

interface Answer {
  kind: '' | 'offer' | 'declined';
  received: string;
  amount: string;
  vat: '' | 'yes' | 'no';
  reason: string;
  note: string;
}

function answerProblem(answer: Answer, range: { min: string; max: string }): string | null {
  if (answer.received < range.min || answer.received > range.max) {
    return `בחרו את יום קבלת התשובה, בין ${shortDay(range.min)} ל-${shortDay(range.max)}.`;
  }
  if (answer.kind === 'declined') {
    return answer.reason === 'other' && answer.note.trim().length < 2
      ? 'כתבו בכמה מילים למה.'
      : null;
  }
  if (answer.kind !== 'offer') return 'בחרו מה הספק ענה.';
  return amountProblem(answer.amount) ?? (answer.vat ? null : 'בחרו אם הסכום כולל מע״מ.');
}

function saveAnswer(row: RequestApproach, answer: Answer): Promise<void> {
  const offer = { amount: cleanAmount(answer.amount), includesVat: answer.vat === 'yes' };
  return recordAnswer({
    approachId: row.id,
    receivedOn: answer.received,
    note: answer.note.trim(),
    ...(answer.kind === 'offer' ? { offer } : { declineReason: answer.reason }),
  });
}

type Options = readonly (readonly [string, string])[];

function Choice(props: { label: string; name: string; value: string; options: Options } & Setter) {
  return (
    <SelectField
      field={{ label: props.label }}
      select={{
        name: props.name,
        value: props.value,
        onChange: (event) => {
          props.set(event.currentTarget.value);
        },
        children: props.options.map(([value, label]) => (
          <option key={value} value={value} disabled={!value}>
            {label}
          </option>
        )),
      }}
    />
  );
}

interface Setter {
  set: (value: string) => void;
}

const KINDS: Options = [
  ['', 'בחרו'],
  ['offer', 'הגיש הצעה'],
  ['declined', 'לא מעוניין'],
];
const VATS: Options = [
  ['', 'בחרו'],
  ['yes', 'כולל מע״מ'],
  ['no', 'לא כולל מע״מ'],
];
const REASONS: Options = Object.entries(DECLINE_LABELS);

function OfferOrReason({ answer, set }: { answer: Answer; set: (next: Answer) => void }) {
  if (answer.kind === 'declined') {
    return (
      <Choice
        label="למה"
        name="reason"
        value={answer.reason}
        options={REASONS}
        set={(reason) => {
          set({ ...answer, reason });
        }}
      />
    );
  }
  if (answer.kind !== 'offer') return null;
  return (
    <>
      <FormField
        field={{ label: 'הסכום בש״ח' }}
        input={{
          name: 'amount',
          inputMode: 'decimal',
          dir: 'ltr',
          autoComplete: 'off',
          value: answer.amount,
          onChange: (event) => {
            set({ ...answer, amount: event.currentTarget.value });
          },
        }}
      />
      <Choice
        label="מע״מ"
        name="vat"
        value={answer.vat}
        options={VATS}
        set={(vat) => {
          set({ ...answer, vat: vat === 'yes' || vat === 'no' ? vat : '' });
        }}
      />
    </>
  );
}

function AnswerFields(props: { answer: Answer; set: (next: Answer) => void; max: string }) {
  const { answer, set } = props;
  return (
    <>
      <Choice
        label="מה הספק ענה"
        name="kind"
        value={answer.kind}
        options={KINDS}
        set={(kind) => {
          set({ ...answer, kind: kind === 'offer' || kind === 'declined' ? kind : '' });
        }}
      />
      <FormField
        field={{ label: 'התקבל ב-' }}
        input={{
          name: 'received_on',
          type: 'date',
          dir: 'ltr',
          max: props.max,
          value: answer.received,
          onChange: (event) => {
            set({ ...answer, received: event.currentTarget.value });
          },
        }}
      />
      <OfferOrReason answer={answer} set={set} />
      <FormField
        field={{ label: 'הערה', hint: 'חובה כשבוחרים "אחר"' }}
        input={{
          name: 'note',
          maxLength: 2000,
          value: answer.note,
          onChange: (event) => {
            set({ ...answer, note: event.currentTarget.value });
          },
        }}
      />
    </>
  );
}

interface RecordProps extends Done {
  row: RequestApproach;
  today: string;
}

/** Controlled, so a refused save keeps what was typed. Sealed like a portal offer (6.3). */
export function RecordAnswer({ row, today, done, cancel }: RecordProps) {
  const range = receivedRange(row, today);
  const ref = useFocusFirst();
  const [answer, setAnswer] = useState<Answer>(() => ({
    kind: '',
    received: range.max,
    amount: '',
    vat: '',
    reason: 'no_capacity',
    note: '',
  }));
  const [error, action, pending] = useActionState(async () => {
    const problem = answerProblem(answer, range);
    if (problem) return problem;
    return attempt(async () => {
      await saveAnswer(row, answer);
      return `התשובה של ${row.supplier_name} נרשמה.`;
    }, done);
  }, '');
  const title = `רישום תשובה של ${row.supplier_name}`;
  return (
    <form ref={ref} action={action} aria-label={title} className={styles.form} noValidate>
      <h3>{title}</h3>
      {error && <Notice tone="error" title={error} />}
      <AnswerFields answer={answer} set={setAnswer} max={range.max} />
      <FormActions>
        <Button variant="quiet" onClick={cancel}>
          ביטול
        </Button>
        <Button type="submit" pending={pending} pendingLabel="רושם…">
          רישום התשובה
        </Button>
      </FormActions>
    </form>
  );
}

interface ExtendProps extends Done {
  requestId: string;
  range: { min: string; max: string };
}

interface ExtendFieldsProps {
  due: string;
  setDue: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  range: { min: string; max: string };
}

function ExtendFields({ due, setDue, reason, setReason, range }: ExtendFieldsProps) {
  return (
    <>
      <FormField
        field={{ label: 'מועד חדש' }}
        input={{
          name: 'respond_by',
          type: 'date',
          dir: 'ltr',
          min: range.min,
          max: range.max,
          value: due,
          onChange: (event) => {
            setDue(event.currentTarget.value);
          },
        }}
      />
      <FormField
        field={{ label: 'למה מאריכים', hint: 'הסיבה נשמרת, כי ההארכה משנה את התנאים לכולם.' }}
        input={{
          name: 'reason',
          maxLength: 500,
          value: reason,
          onChange: (event) => {
            setReason(event.currentTarget.value);
          },
        }}
      />
    </>
  );
}

/** Every open deadline of the request moves together, and the reason is kept (6.2). */
export function ExtendDeadline({ requestId, range, done, cancel }: ExtendProps) {
  const ref = useFocusFirst();
  const [due, setDue] = useState(range.min);
  const [reason, setReason] = useState('');
  const [error, action, pending] = useActionState(async () => {
    if (due < range.min || due > range.max) {
      return `בחרו מועד בין ${shortDay(range.min)} ל-${shortDay(range.max)}.`;
    }
    if (reason.trim().length < 3) return 'כתבו למה המועד מוארך, לפחות 3 תווים.';
    return attempt(async () => {
      const moved = await extendDeadline(requestId, due, reason.trim());
      return `המועד הוארך ל-${shortDay(due)} ב-${String(moved)} פניות.`;
    }, done);
  }, '');
  return (
    <form ref={ref} action={action} aria-label="הארכת המועד" className={styles.form} noValidate>
      <h3>הארכת המועד</h3>
      <p>המועד החדש חל על כל הפניות שעוד פתוחות, וההצעות ייפתחו רק אחריו.</p>
      {error && <Notice tone="error" title={error} />}
      <ExtendFields due={due} setDue={setDue} reason={reason} setReason={setReason} range={range} />
      <FormActions>
        <Button variant="quiet" onClick={cancel}>
          ביטול
        </Button>
        <Button type="submit" pending={pending} pendingLabel="שומר…">
          שמירת המועד החדש
        </Button>
      </FormActions>
    </form>
  );
}

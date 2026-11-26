// Choosing the winner of a request (alignment review, stage C, 25.11). Only an opened offer
// can win; the reason is optional. Choosing closes the request, and every supplier that
// offered sees in its personal area whether it was chosen.
import { useActionState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { awardRequest, type RequestApproach } from '../api/approaches.ts';
import { answerText } from '../model/approaches.ts';
import styles from './route-check.module.css';

const NOTE_MAX = 2000;

/** An approach that can win: its offer was opened (the deadline passed). */
export const awardable = (row: RequestApproach) =>
  !row.sealed && row.answer?.answer === 'offer' && typeof row.answer.offer_amount === 'number';

interface Props {
  requestId: string;
  row: RequestApproach;
  done: (message: string) => void;
  cancel: () => void;
}

export function AwardForm({ requestId, row, done, cancel }: Props) {
  const [error, action, pending] = useActionState(async (_: string, form: FormData) => {
    const raw = form.get('note');
    const note = typeof raw === 'string' ? raw : '';
    if (note.trim().length > NOTE_MAX) return 'הנימוק ארוך מדי. כתבו עד 2,000 תווים.';
    try {
      await awardRequest(requestId, row.id, note);
    } catch (cause) {
      return errorText(cause);
    }
    done(`${row.supplier_name} נבחר כזוכה, והבקשה נסגרה.`);
    return '';
  }, '');
  return (
    <form action={action} aria-label={`בחירת ${row.supplier_name} כזוכה`} className={styles.form}>
      <h3>{`בחירת ${row.supplier_name} כזוכה`}</h3>
      <p>{answerText(row.answer)}</p>
      <p>
        הבקשה תיסגר, ולא יהיה אפשר להוסיף לה פניות. כל ספק שהגיש הצעה יראה באזור האישי אם נבחר, בלי
        שם הזוכה ובלי סכומים.
      </p>
      {error && <Notice tone="error" title={error} />}
      <FormField
        field={{ label: 'נימוק (לא חובה)', hint: 'למשל: ההצעה הזולה ביותר שעמדה בדרישות.' }}
        input={{ name: 'note', maxLength: NOTE_MAX }}
      />
      <FormActions>
        <Button type="submit" pending={pending} pendingLabel="שומר…">
          בחירה כזוכה
        </Button>
        <Button variant="secondary" onClick={cancel}>
          ביטול
        </Button>
      </FormActions>
    </form>
  );
}

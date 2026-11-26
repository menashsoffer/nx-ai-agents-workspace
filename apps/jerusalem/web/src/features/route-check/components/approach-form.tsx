// Recording an approach with its channel and deadline (supplier-approaches-spec-he.md 6.1).
// The database checks the range again and refuses another unit's request.
import { useActionState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { errorText } from '../../../data/errors.ts';
import { recordApproaches } from '../api/engagement.ts';
import { CHANNEL_LABELS, CHANNELS, deadlineRange, shortDay } from '../model/approaches.ts';
import styles from './route-check.module.css';

export const APPROACH_DIALOG = 'approach-suppliers';

interface Props {
  requestId: string;
  suppliers: string[];
  today: string;
  /** The status line after a save. */
  done: (message: string) => void;
}

function closeDialog(): void {
  const dialog = document.getElementById(APPROACH_DIALOG);
  if (dialog instanceof HTMLDialogElement) dialog.close();
}

export function addedText(added: number, picked: number, respondBy: string): string {
  const skipped = picked - added;
  const already = skipped > 0 ? ` ${String(skipped)} כבר קיבלו פנייה לבקשה הזו.` : '';
  return `נרשמו ${String(added)} פניות, עם מועד לתשובה ${shortDay(respondBy)}.${already}`;
}

function ChannelField() {
  return (
    <SelectField
      field={{ label: 'איך פניתם' }}
      select={{
        name: 'channel',
        defaultValue: 'email',
        children: CHANNELS.map((channel) => (
          <option key={channel} value={channel}>
            {CHANNEL_LABELS[channel]}
          </option>
        )),
      }}
    />
  );
}

export function ApproachForm({ requestId, suppliers, today, done }: Props) {
  const range = deadlineRange(today);
  const [error, action, pending] = useActionState(async (_: string, form: FormData) => {
    const channel = CHANNELS.find((c) => c === form.get('channel')) ?? 'email';
    const due = form.get('respond_by');
    const respondBy = typeof due === 'string' ? due : '';
    try {
      const added = await recordApproaches({ request: requestId, suppliers, channel, respondBy });
      closeDialog();
      done(addedText(added, suppliers.length, respondBy));
      return '';
    } catch (cause) {
      return errorText(cause);
    }
  }, '');
  return (
    <form action={action} aria-label="רישום פנייה לספקים" className={styles.form}>
      <p>{`${String(suppliers.length)} ספקים פעילים ברשימה יירשמו עם הפנייה.`}</p>
      {error && <Notice tone="error" title={error} />}
      <ChannelField />
      <FormField
        field={{
          label: 'עד מתי לענות',
          hint: 'מחר ועד 90 יום. סכומי ההצעות ייפתחו לכם רק אחרי המועד.',
        }}
        input={{
          name: 'respond_by',
          type: 'date',
          required: true,
          dir: 'ltr',
          min: range.min,
          max: range.max,
          defaultValue: range.initial,
        }}
      />
      <FormActions>
        <Button variant="quiet" command={{ target: APPROACH_DIALOG, action: 'close' }}>
          ביטול
        </Button>
        <Button type="submit" pending={pending} pendingLabel="רושם פנייה…">
          רישום הפנייה
        </Button>
      </FormActions>
    </form>
  );
}

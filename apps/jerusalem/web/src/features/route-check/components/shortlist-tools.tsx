import { useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { StatusMessage } from '../../../ui/status-message.tsx';
import { bccLine, bccMessage, shareLink, type PickedSupplier } from '../model/engagement.ts';
import { APPROACH_DIALOG, ApproachForm } from './approach-form.tsx';

interface Props {
  suppliers: readonly PickedSupplier[];
  today: string;
  requestId: string | null;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The clipboard can be refused; the message then says so instead of claiming a copy. */
function useTools({ suppliers, today }: Props) {
  const [message, setMessage] = useState('');
  return {
    message,
    setMessage,
    async bcc() {
      const line = bccLine(suppliers);
      if (!line.count) {
        setMessage('לאף ספק בבקשה אין דוא״ל במאגר.');
        return;
      }
      setMessage((await copy(line.text)) ? bccMessage(line) : 'ההעתקה נכשלה.');
    },
    async share() {
      const ok = await copy(shareLink(window.location.href, suppliers));
      setMessage(ok ? 'הקישור הועתק. הוא נפתח רק למשתמשים מחוברים עם הרשאה.' : 'ההעתקה נכשלה.');
    },
    async csv() {
      const { downloadCsv } = await import('../model/csv.ts');
      downloadCsv(suppliers, today);
      setMessage('הקובץ הורד, בלי מספרי זהות.');
    },
  };
}

/** Step 3 actions: recording the approach is the main one, and only for a saved request. */
export function ShortlistTools(props: Props) {
  const tools = useTools(props);
  const active = props.suppliers.filter((s) => !s.inactive).map((s) => s.id);
  return (
    <section aria-label="פעולות על הבקשה">
      <FormActions>
        {props.requestId && (
          <Button
            command={{ target: APPROACH_DIALOG, action: 'show-modal' }}
            data-usage="request.approach"
          >
            רישום פנייה לספקים
          </Button>
        )}
        <Button variant="secondary" onClick={() => void tools.bcc()} data-usage="request.bcc">
          העתקת כתובות ל-BCC
        </Button>
        <Button variant="secondary" onClick={() => void tools.csv()} data-usage="request.export">
          ייצוא לקובץ
        </Button>
        <Button variant="secondary" onClick={() => void tools.share()} data-usage="request.share">
          העתקת קישור
        </Button>
      </FormActions>
      <StatusMessage>{tools.message}</StatusMessage>
      {props.requestId && (
        <Dialog id={APPROACH_DIALOG} title="רישום פנייה לספקים">
          <ApproachForm
            requestId={props.requestId}
            suppliers={active}
            today={props.today}
            done={tools.setMessage}
          />
        </Dialog>
      )}
    </section>
  );
}

import { useActionState, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { dayOf } from '../../../lib/dates.ts';
import { DOCUMENT_LABELS } from '../api/document-kinds.ts';
import { approveDocument, rejectDocument, type QueuedDocument } from '../api/documents.ts';
import { proofUrl } from '../api/links.ts';
import styles from './links.module.css';

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** Approve with the date as uploaded or corrected, or reject with a reason the supplier sees. */
function Decide({ doc }: { doc: QueuedDocument }) {
  const id = `document-${doc.id}`;
  const title = `בדיקת ${DOCUMENT_LABELS[doc.kind]} של ${doc.supplier_name}`;
  const [error, action, saving] = useActionState(async (_previous: string, form: FormData) => {
    const note = field(form, 'note');
    const approve = form.get('decision') === 'approve';
    if (!approve && note.length < 2) return 'צריך לכתוב סיבה לדחייה. הספק יראה אותה.';
    const until = field(form, 'valid_until');
    const message = approve
      ? await approveDocument(doc.id, until && until !== doc.valid_until ? until : null)
      : await rejectDocument(doc.id, note);
    if (!message) (document.getElementById(id) as HTMLDialogElement | null)?.close();
    return message;
  }, '');
  return (
    <>
      <Button type="button" command={{ target: id, action: 'show-modal' }}>
        בדיקה
      </Button>
      <Dialog id={id} title={title}>
        <form action={action} aria-label={title} noValidate>
          {error && <Notice tone="error" title={error} />}
          <FormField
            field={{ label: 'בתוקף עד', hint: 'תקנו אם התאריך באישור שונה ממה שהספק הזין.' }}
            input={{ name: 'valid_until', type: 'date', defaultValue: doc.valid_until }}
          />
          <FormField
            field={{ label: 'סיבה לדחייה', hint: 'רק בדחייה. הספק רואה אותה.' }}
            input={{ name: 'note', maxLength: 2000 }}
          />
          <FormActions>
            <Button type="submit" name="decision" value="approve" pending={saving}>
              אישור
            </Button>
            <Button type="submit" name="decision" value="reject" variant="secondary">
              דחייה
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}

function OpenFile({ path }: { path: string }) {
  const [error, setError] = useState('');
  async function open() {
    try {
      window.open(await proofUrl(path), '_blank', 'noopener');
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  return (
    <>
      <Button type="button" variant="quiet" icon="shield" onClick={() => void open()}>
        פתיחת הקובץ
      </Button>
      {error && <Notice tone="error" title={error} />}
    </>
  );
}

export function DocumentRow({ doc }: { doc: QueuedDocument }) {
  return (
    <li className={styles.row}>
      <div>
        <strong>{DOCUMENT_LABELS[doc.kind]}</strong>
        <div>
          <Link to={`/supplier/${doc.supplier_id}`}>{doc.supplier_name}</Link>
          <span className={styles.muted}>
            {` · בתוקף עד ${dayOf(doc.valid_until)} · הועלה ב-${dayOf(doc.created_at)}`}
          </span>
        </div>
      </div>
      <div className={styles.actions}>
        <OpenFile path={doc.storage_path} />
        <Decide doc={doc} />
      </div>
    </li>
  );
}

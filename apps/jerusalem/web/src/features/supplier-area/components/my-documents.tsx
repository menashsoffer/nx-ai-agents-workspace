import { useActionState, useId, useState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { sendDocument } from '../api/documents.ts';
import { PROOF_MAX_BYTES, PROOF_TYPES } from '../api/portal.ts';
import { DOCUMENT_LABELS } from '../model/kinds.ts';
import { rowText, untilProblem, type KindRow } from '../model/documents.ts';
import { plusDays, proofProblem } from '../model/portal-model.ts';
import styles from './area.module.css';

interface Sent {
  error: string;
  until: string;
}

function useUpload(today: string, send: (file: File, until: string) => Promise<void>) {
  const { revalidate } = useRevalidator();
  const [file, setFile] = useState<File | null>(null);
  const [state, action, pending] = useActionState(
    async (_previous: Sent, form: FormData): Promise<Sent> => {
      const raw = form.get('valid_until');
      const until = typeof raw === 'string' ? raw : '';
      const problem =
        proofProblem(file, PROOF_TYPES, PROOF_MAX_BYTES) ?? untilProblem(until, today);
      if (problem || !file) return { error: problem ?? '', until };
      try {
        await send(file, until);
      } catch (failure) {
        return { error: errorText(failure), until };
      }
      await revalidate();
      return { error: '', until: '' };
    },
    { error: '', until: '' },
  );
  return { state, action, pending, setFile };
}

/** "העלאה" or "החלפה": the file and the date it is valid until (spec 6.5). */
function Upload({ supplierId, row, today }: { supplierId: string; row: KindRow; today: string }) {
  const id = useId();
  const label = DOCUMENT_LABELS[row.kind];
  const { state, action, pending, setFile } = useUpload(today, async (file, until) => {
    await sendDocument({ supplierId, kind: row.kind, file, validUntil: until });
    (document.getElementById(id) as HTMLDialogElement | null)?.close();
  });
  const verb = row.state === 'missing' ? 'העלאה' : 'החלפה';
  return (
    <>
      <Button type="button" variant="secondary" command={{ target: id, action: 'show-modal' }}>
        {verb}
      </Button>
      <Dialog id={id} title={`${verb}: ${label}`}>
        <form action={action} aria-label={`${verb}: ${label}`} noValidate>
          {state.error && <Notice tone="error" title={state.error} />}
          <FormField
            field={{ label: 'הקובץ', hint: 'PDF, JPEG או PNG, עד 10MB' }}
            input={{
              name: 'file',
              type: 'file',
              accept: PROOF_TYPES.join(','),
              onChange: (event) => {
                setFile(event.currentTarget.files?.[0] ?? null);
              },
            }}
          />
          <FormField
            field={{ label: 'בתוקף עד', hint: 'כפי שכתוב באישור. העירייה תבדוק את התאריך.' }}
            input={{
              name: 'valid_until',
              type: 'date',
              required: true,
              min: today,
              max: plusDays(today, 3652),
              defaultValue: state.until,
            }}
          />
          <FormActions>
            <Button type="submit" pending={pending} pendingLabel="מעלה…" data-usage="portal.upload">
              שליחה לבדיקה
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}

interface Props {
  supplierId: string;
  rows: KindRow[];
  today: string;
}

/** "המסמכים שלי" (spec 6.5): one row per kind, with its state and an upload. */
export function MyDocuments({ supplierId, rows, today }: Props) {
  return (
    <section className={styles.panel} aria-labelledby="documents-title">
      <h2 id="documents-title" tabIndex={-1}>
        המסמכים שלי
      </h2>
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.kind} data-state={row.state === 'ending' ? 'soon' : row.state}>
            <strong>{DOCUMENT_LABELS[row.kind]}</strong>
            <span className={styles.until}>{rowText(row)}</span>
            <Upload supplierId={supplierId} row={row} today={today} />
          </li>
        ))}
      </ul>
      <p className={styles.muted}>העירייה בודקת כל מסמך לפני שהוא נכנס לתוקף.</p>
    </section>
  );
}

import { useActionState, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { dayOf } from '../../../lib/dates.ts';
import { approveLink, proofUrl, rejectLink, revokeLink, type SupplierLink } from '../api/links.ts';
import styles from './links.module.css';

export const METHOD_LABELS: Record<SupplierLink['method'], string> = {
  email_match: 'התאמת דוא"ל',
  invite: 'הזמנה',
  document: 'מסמך הוכחה',
};

const note = (form: FormData) => {
  const value = form.get('note');
  return typeof value === 'string' ? value.trim() : '';
};

/** Reject a waiting link or revoke an active one; both need a reason the person sees. */
function ReasonDialog({ link }: { link: SupplierLink }) {
  const pending = link.status === 'pending';
  const id = `link-${pending ? 'reject' : 'revoke'}-${link.id}`;
  const title = pending
    ? `דחיית השיוך ל${link.supplier_name}`
    : `ביטול השיוך ל${link.supplier_name}`;
  const [error, action, saving] = useActionState(async (_previous: string, form: FormData) => {
    const reason = note(form);
    if (reason.length < 2) return 'צריך לכתוב סיבה. האדם יראה אותה.';
    const message = await (pending ? rejectLink(link.id, reason) : revokeLink(link.id, reason));
    if (!message) (document.getElementById(id) as HTMLDialogElement | null)?.close();
    return message;
  }, '');
  return (
    <>
      <Button type="button" variant="secondary" command={{ target: id, action: 'show-modal' }}>
        {pending ? 'דחייה' : 'ביטול השיוך'}
      </Button>
      <Dialog id={id} title={title}>
        <form action={action} aria-label={title} noValidate>
          {error && <Notice tone="error" title={error} />}
          <FormField
            field={{ label: 'סיבה', hint: 'הסיבה מוצגת לאדם באזור האישי.' }}
            input={{ name: 'note', required: true, maxLength: 2000 }}
          />
          <FormActions>
            <Button type="submit" pending={saving}>
              {pending ? 'דחייה' : 'ביטול השיוך'}
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}

function Proof({ path }: { path: string }) {
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
        פתיחת ההוכחה
      </Button>
      {error && <Notice tone="error" title={error} />}
    </>
  );
}

function Approve({ link }: { link: SupplierLink }) {
  const [error, action, saving] = useActionState(() => approveLink(link.id), '');
  return (
    <form action={action}>
      <Button type="submit" pending={saving} pendingLabel="מאשר…">
        אישור
      </Button>
      {error && <Notice tone="error" title={error} />}
    </form>
  );
}

export function LinkRow({ link }: { link: SupplierLink }) {
  const person = [link.first_name, link.last_name].filter(Boolean).join(' ') || 'בלי שם';
  return (
    <li className={styles.row}>
      <div>
        <strong>{person}</strong>
        {link.job_title && <span> · {link.job_title}</span>}
        <div className={styles.muted}>
          <bdi>{link.email}</bdi>
          {link.phone && (
            <>
              {' · '}
              <bdi>{link.phone}</bdi>
            </>
          )}
        </div>
        <div>
          <Link to={`/supplier/${link.supplier_id}`}>{link.supplier_name}</Link>
          <span className={styles.muted}>
            {' · '}
            {METHOD_LABELS[link.method]} · {dayOf(link.created_at)}
          </span>
        </div>
      </div>
      <div className={styles.actions}>
        {link.proof_path && <Proof path={link.proof_path} />}
        {link.status === 'pending' && <Approve link={link} />}
        <ReasonDialog link={link} />
      </div>
    </li>
  );
}

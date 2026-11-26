import { useActionState, useEffect, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { dayOf } from '../../../lib/dates.ts';
import { loadAreaAccounts, revokeAreaAccount, type AreaAccount } from '../api/invite.ts';
import styles from './supplier.module.css';

const STATUS: Record<AreaAccount['status'], string> = {
  active: 'פעיל',
  pending: 'ממתין לאישור',
  rejected: 'נדחה',
  revoked: 'בוטל',
};
const METHOD: Record<AreaAccount['method'], string> = {
  email_match: 'התאמת דוא"ל',
  invite: 'הזמנה',
  document: 'מסמך הוכחה',
};
const ROLE: Record<AreaAccount['role'], string> = { owner: 'בעלים', member: 'חבר צוות' };

function Revoke({ account, onDone }: { account: AreaAccount; onDone: () => void }) {
  const id = `area-revoke-${account.id}`;
  const [error, action, saving] = useActionState(async (_previous: string, form: FormData) => {
    const value = form.get('note');
    const note = typeof value === 'string' ? value.trim() : '';
    if (note.length < 2) return 'צריך לכתוב סיבה. האדם יראה אותה.';
    const message = await revokeAreaAccount(account.id, note);
    if (!message) {
      (document.getElementById(id) as HTMLDialogElement | null)?.close();
      onDone();
    }
    return message;
  }, '');
  return (
    <>
      <Button type="button" variant="quiet" command={{ target: id, action: 'show-modal' }}>
        ביטול השיוך
      </Button>
      <Dialog id={id} title="ביטול השיוך לאזור האישי">
        <form action={action} aria-label="ביטול השיוך לאזור האישי" noValidate>
          {error && <Notice tone="error" title={error} />}
          <FormField
            field={{ label: 'סיבה', hint: 'הסיבה מוצגת לאדם באזור האישי.' }}
            input={{ name: 'note', required: true, maxLength: 2000 }}
          />
          <FormActions>
            <Button type="submit" pending={saving}>
              ביטול השיוך
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}

function useAccounts(supplierId: string) {
  const [state, setState] = useState<{ rows: AreaAccount[] | null; error: string }>({
    rows: null,
    error: '',
  });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    loadAreaAccounts(supplierId).then(
      (rows) => {
        if (live) setState({ rows, error: '' });
      },
      (failure: unknown) => {
        if (live) setState({ rows: [], error: errorText(failure) });
      },
    );
    return () => {
      live = false;
    };
  }, [supplierId, round]);
  return {
    ...state,
    reload: () => {
      setRound((n) => n + 1);
    },
  };
}

/** Who is linked to the supplier, how and when; an admin can end a link (spec 6.10). */
export function AreaAccounts({ supplierId, admin }: { supplierId: string; admin: boolean }) {
  const { rows, error, reload } = useAccounts(supplierId);
  if (error) return <Notice tone="error" title={error} />;
  if (!rows) return <p className={styles.muted}>טוען את המשויכים…</p>;
  if (rows.length === 0) return <p className={styles.muted}>אף אחד עוד לא משויך לספק.</p>;
  return (
    <ul className={styles.accounts} aria-label="משויכים לאזור האישי">
      {rows.map((account) => {
        const name = [account.first_name, account.last_name].filter(Boolean).join(' ');
        const live = account.status === 'active' || account.status === 'pending';
        return (
          <li key={account.id}>
            <strong>{name || <bdi>{account.email ?? 'בלי שם'}</bdi>}</strong>
            {name && account.email && (
              <span className={styles.muted}>
                {' · '}
                <bdi>{account.email}</bdi>
              </span>
            )}
            <div className={styles.muted}>
              {`${STATUS[account.status]} · ${ROLE[account.role]} · ${METHOD[account.method]} · `}
              {dayOf(account.created_at)}
              {account.decision_note && ` · הסיבה: ${account.decision_note}`}
            </div>
            {admin && live && <Revoke account={account} onDone={reload} />}
          </li>
        );
      })}
    </ul>
  );
}

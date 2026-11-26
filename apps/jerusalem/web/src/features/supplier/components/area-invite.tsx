import { useActionState } from 'react';
import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { Button } from '../../../ui/button.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { inviteToArea } from '../api/invite.ts';
import { AreaAccounts } from './area-accounts.tsx';
import { AreaInvites } from './area-invites.tsx';
import styles from './supplier.module.css';

interface State {
  error: string;
  sent: string;
  /** Bumped on each save, so the invite list reloads. */
  round: number;
}

/** Who is linked to the supplier area, and an invite for one of the supplier's own emails. */
export function AreaInvite({ data, admin = false }: { data: SupplierDetail; admin?: boolean }) {
  const emails = data.contacts.filter((c) => c.kind === 'email' && c.is_valid).map((c) => c.value);
  const [state, action, pending] = useActionState(
    async (previous: State, form: FormData): Promise<State> => {
      const value = form.get('email');
      const email = typeof value === 'string' ? value : '';
      const error = await inviteToArea(data.supplier.id, email);
      return { error, sent: error ? '' : email, round: previous.round + 1 };
    },
    { error: '', sent: '', round: 0 },
  );
  return (
    <section className={styles.card} aria-labelledby="supplier-area-invite">
      <h2 id="supplier-area-invite">האזור האישי</h2>
      <AreaAccounts supplierId={data.supplier.id} admin={admin} />
      {emails.length === 0 ? (
        <p className={styles.muted}>אין לספק דוא"ל תקין, ולכן אי אפשר להזמין אותו.</p>
      ) : (
        <InviteForm emails={emails} action={action} pending={pending} />
      )}
      {state.error && <Notice tone="error" title={state.error} />}
      {state.sent && (
        <Notice tone="success" title={`ההזמנה ל-${state.sent} נשמרה, בתוקף 14 יום.`}>
          המערכת לא שולחת דוא"ל. העתיקו את ההודעה שליד ההזמנה ושלחו אותה לספק.
        </Notice>
      )}
      <AreaInvites key={state.round} supplierId={data.supplier.id} />
    </section>
  );
}

interface FormProps {
  emails: string[];
  action: (form: FormData) => void;
  pending: boolean;
}

function InviteForm({ emails, action, pending }: FormProps) {
  return (
    <form action={action} aria-label="הזמנה לאזור האישי">
      {emails.length === 1 ? (
        <OnlyEmail email={emails[0] ?? ''} />
      ) : (
        <EmailChoice emails={emails} />
      )}
      <Button type="submit" variant="secondary" pending={pending} pendingLabel="שומר…">
        הזמנה לאזור האישי
      </Button>
    </form>
  );
}

/** One email needs no choice: show it, and send it with the form. */
function OnlyEmail({ email }: { email: string }) {
  return (
    <p>
      ההזמנה תישמר לדוא"ל <bdi>{email}</bdi>
      <input type="hidden" name="email" value={email} />
    </p>
  );
}

function EmailChoice({ emails }: { emails: string[] }) {
  return (
    <SelectField
      field={{ label: 'דוא"ל להזמנה', hint: 'רק דוא"ל שכבר רשום לספק' }}
      select={{
        name: 'email',
        required: true,
        children: emails.map((email) => (
          <option key={email} value={email}>
            {email}
          </option>
        )),
      }}
    />
  );
}

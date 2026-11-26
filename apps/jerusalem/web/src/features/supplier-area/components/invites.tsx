import { useActionState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { dayOf } from '../../../lib/dates.ts';
import { acceptInvite, type PortalInvite } from '../api/portal.ts';
import styles from './area.module.css';

function Invite({ invite }: { invite: PortalInvite }) {
  const { revalidate } = useRevalidator();
  const [error, action, pending] = useActionState(async () => {
    try {
      await acceptInvite(invite.id);
      await revalidate();
      return '';
    } catch (failure) {
      return errorText(failure);
    }
  }, '');
  return (
    <li>
      <form action={action} aria-label={`הזמנה מ${invite.supplier_name}`}>
        <strong>{invite.supplier_name}</strong>
        <span> · בתוקף עד {dayOf(invite.expires_at)}</span>
        {error && <Notice tone="error" title={error} />}
        <Button type="submit" pending={pending} pendingLabel="מאשר…">
          קבלת ההזמנה
        </Button>
      </form>
    </li>
  );
}

/** Invites the municipality sent to this person's sign-in email (spec 5.1). */
export function Invites({ invites }: { invites: PortalInvite[] }) {
  return (
    <section className={styles.panel} aria-labelledby="invites-title">
      <h2 id="invites-title">הוזמנתם לאזור האישי</h2>
      <ul className={styles.list}>
        {invites.map((invite) => (
          <Invite key={invite.id} invite={invite} />
        ))}
      </ul>
    </section>
  );
}

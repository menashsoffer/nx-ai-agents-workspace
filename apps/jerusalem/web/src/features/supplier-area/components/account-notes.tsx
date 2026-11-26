import { Notice } from '../../../ui/notice.tsx';
import { dayOf } from '../../../lib/dates.ts';
import type { PortalAccount } from '../api/portal.ts';
import { accountNote } from '../model/portal-model.ts';

/** Links that are not active: what happened and when (spec 6.2, 6.11). */
export function AccountNotes({ accounts }: { accounts: PortalAccount[] }) {
  const waiting = accounts.filter((a) => a.status !== 'active');
  if (waiting.length === 0) return null;
  return (
    <>
      {waiting.map((account) => (
        <Notice
          key={account.id}
          tone={account.status === 'pending' ? 'info' : 'warning'}
          title={`${account.supplier_name}: ${accountNote(account)}`}
        >
          הבקשה נשלחה ב-{dayOf(account.created_at)}.
        </Notice>
      ))}
    </>
  );
}

import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { AreaInvite } from './area-invite.tsx';
import { ContactCard } from './contact-card.tsx';
import { EditDialog } from './edit-dialog.tsx';
import { SupplierHeader } from './header.tsx';
import { History } from './history.tsx';
import { IdentityCard, Sources } from './identity-card.tsx';
import { Listings } from './listings.tsx';
import { PendingChanges } from './pending-changes.tsx';
import { VerdictBand } from './verdict-band.tsx';
import type { ChangeRequest } from '../../../data/supplier-changes.ts';
import styles from './supplier.module.css';

interface Props {
  data: SupplierDetail;
  today: string;
  editor?: boolean;
  admin?: boolean;
  /** Waiting changes the signed-in person may see, and who that person is. */
  pending?: { changes: readonly ChangeRequest[]; userId: string | null };
}

/** The supplier screen (documentation/supplier-page-spec-he.md): header, listings, side cards. */
export function SupplierDetails({ data, today, editor = false, admin = false, pending }: Props) {
  return (
    <>
      <SupplierHeader data={data} editor={editor || admin} />
      <VerdictBand data={data} today={today} />
      {/* Two columns on a computer (DESIGN.md 6.5): the registries, waiting changes and history on
          the wide side, the short cards beside them, so neither column is left half empty. On a
          phone the DOM order is the reading order of spec section 5. */}
      <div className={styles.layout}>
        <div className={styles.listingsArea}>
          <Listings data={data} today={today} />
        </div>
        {pending && (
          <div className={styles.pendingArea}>
            <PendingChanges
              changes={pending.changes}
              userId={pending.userId}
              admin={admin}
              editor={editor}
            />
          </div>
        )}
        <div className={styles.side}>
          <ContactCard contacts={data.contacts} />
          <IdentityCard data={data} />
          <Sources data={data} />
          {(editor || admin) && data.supplier.status === 'active' && (
            <AreaInvite data={data} admin={admin} />
          )}
        </div>
        <div className={styles.historyArea}>
          <History audit={data.audit} />
        </div>
      </div>
      {(editor || admin) && <EditDialog data={data} editor={editor} admin={admin} today={today} />}
    </>
  );
}

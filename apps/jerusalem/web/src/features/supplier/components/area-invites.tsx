import { useEffect, useState } from 'react';
import { errorText } from '../../../data/errors.ts';
import { Notice } from '../../../ui/notice.tsx';
import { areaLink, loadInvites } from '../api/invite.ts';
import { inviteAge, inviteMessage, type Invite } from '../model/invite-age.ts';
import { CopyButton } from './copy-button.tsx';
import styles from './supplier.module.css';

function useInvites(supplierId: string) {
  const [state, setState] = useState<{ rows: Invite[] | null; error: string }>({
    rows: null,
    error: '',
  });
  useEffect(() => {
    let live = true;
    loadInvites(supplierId).then(
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
  }, [supplierId]);
  return state;
}

function InviteRow({ invite, link, now }: { invite: Invite; link: string; now: Date }) {
  const age = inviteAge(invite, now);
  const id = `invite-age-${invite.id}`;
  return (
    <li>
      <div className={styles.inviteHead}>
        <bdi>{invite.email}</bdi>
        {age.state === 'open' && (
          <CopyButton value={inviteMessage(invite, link)} label={`ההודעה ל-${invite.email}`} />
        )}
      </div>
      <div className={styles.muted}>{age.sent}</div>
      <div id={id} className={age.state === 'expired' ? styles.warn : styles.muted}>
        {age.status}
      </div>
      {age.state === 'open' && (
        <progress
          className={styles.inviteAge}
          value={age.elapsed}
          max={age.length}
          aria-labelledby={id}
        />
      )}
    </li>
  );
}

/** The area link to copy, and how long each invite has been out (spec 5.1, version 1). */
export function AreaInvites({ supplierId }: { supplierId: string }) {
  const { rows, error } = useInvites(supplierId);
  const link = areaLink();
  const now = new Date();
  return (
    <div className={styles.invites}>
      <div className={styles.inviteHead}>
        <span className={styles.muted}>קישור לאזור האישי:</span>
        <bdi className={styles.inviteLink}>{link}</bdi>
        <CopyButton value={link} label="הקישור לאזור האישי" />
      </div>
      {error && <Notice tone="error" title={error} />}
      {rows && rows.length > 0 && (
        <>
          <h3>הזמנות</h3>
          <ul className={styles.accounts} aria-label="הזמנות לאזור האישי">
            {rows.slice(0, 5).map((invite) => (
              <InviteRow key={invite.id} invite={invite} link={link} now={now} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

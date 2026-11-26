import { useState } from 'react';
import { Dialog } from '../../../ui/dialog.tsx';
import { dayOf } from '../../../lib/dates.ts';
import type { ChangeRequest, MyGrant, Unit } from '../api/account.ts';
import { changeSummary, grantLabel, STATUS_LABELS } from '../../../data/access-change-labels.ts';
import { CancelChange } from './cancel-change.tsx';
import { ChangeForm } from './change-form.tsx';
import styles from './account.module.css';

export const CHANGE_DIALOG = 'access-change';

interface Props {
  units: Unit[];
  grants: MyGrant[];
  changes: ChangeRequest[] | null;
}

function close() {
  const dialog = document.getElementById(CHANGE_DIALOG);
  if (dialog instanceof HTMLDialogElement) dialog.close();
}

function History({
  changes,
  names,
  grants,
}: {
  changes: ChangeRequest[];
  names: Map<string, string>;
  grants: MyGrant[];
}) {
  if (!changes.length) return null;
  return (
    <div className={styles.requests}>
      <h3>הבקשות שלי</h3>
      <ul className={styles.history}>
        {changes.map((c) => (
          <li key={c.id}>
            <strong>{changeSummary(c, names, grants)}</strong>
            <span>
              {STATUS_LABELS[c.status]} · {dayOf(c.created_at)}
            </span>
            {c.status === 'rejected' && c.decision_note && (
              <span>סיבת הדחייה: {c.decision_note}</span>
            )}
            {c.status === 'pending' && <CancelChange id={c.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "התפקידים שלי": active roles as tags, the request dialog and the requests so far. */
export function MyRoles({ units, grants, changes }: Props) {
  // A new form each time the dialog closes, so an old answer is not left in it.
  const [round, setRound] = useState(0);
  const names = new Map(units.map((u) => [u.id, u.name]));
  const busy = new Set((changes ?? []).filter((c) => c.status === 'pending').map((c) => c.kind));
  return (
    <section aria-labelledby="my-roles" className={styles.panel}>
      <h2 id="my-roles">התפקידים שלי</h2>
      {grants.length ? (
        <ul className={styles.tags}>
          {grants.map((g) => (
            <li key={g.id}>{grantLabel(g, names)}</li>
          ))}
        </ul>
      ) : (
        <p>אין תפקיד פעיל.</p>
      )}
      {changes && (
        <>
          <History changes={changes} names={names} grants={grants} />
          <Dialog
            id={CHANGE_DIALOG}
            title="בקשה לשינוי תפקיד או יחידה"
            onClose={() => {
              setRound((n) => n + 1);
            }}
          >
            <ChangeForm key={round} units={units} grants={grants} busy={busy} done={close} />
          </Dialog>
        </>
      )}
    </section>
  );
}

import { useActionState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { dayOf } from '../../../lib/dates.ts';
import { cancelProposal, type Proposal } from '../api/portal.ts';
import { PROPOSAL_STATUS, proposalLabel } from '../model/portal-model.ts';
import styles from './area.module.css';

function Cancel({ proposal }: { proposal: Proposal }) {
  const { revalidate } = useRevalidator();
  const [error, action, pending] = useActionState(async () => {
    try {
      await cancelProposal(proposal.id);
    } catch (failure) {
      return errorText(failure);
    }
    await revalidate();
    return '';
  }, '');
  return (
    <form action={action}>
      <Button type="submit" variant="quiet" pending={pending}>
        ביטול הבקשה
      </Button>
      {error && <Notice tone="error" title={error} />}
    </form>
  );
}

/** "הבקשות שלי" (spec 6.3): every fix the supplier sent, with its state and reason. */
export function MyRequests({ proposals }: { proposals: Proposal[] }) {
  if (proposals.length === 0) return null;
  return (
    <section aria-labelledby="requests-title">
      <h3 id="requests-title" tabIndex={-1}>
        הבקשות שלי
      </h3>
      <ul className={styles.list}>
        {proposals.map((p) => (
          <li key={p.id}>
            <strong>{proposalLabel(p.kind, p.contact_kind)}</strong>: <bdi>{p.new_value}</bdi>
            <span className={styles.muted}>
              {` · ${PROPOSAL_STATUS[p.status] ?? p.status} · נשלחה ב-${dayOf(p.created_at)}`}
              {p.decision_note && ` · הסיבה: ${p.decision_note}`}
            </span>
            {p.mine && p.status === 'pending' && <Cancel proposal={p} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

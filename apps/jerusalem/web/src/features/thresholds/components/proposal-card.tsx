import { useId } from 'react';
import { Button } from '../../../ui/button.tsx';
import { dayOf } from '../../../lib/dates.ts';
import type { Proposal, Threshold } from '../api/proposals.ts';
import { ProposalComparison } from './proposal-comparison.tsx';
import { ApproveDialog, approveId, RejectDialog, rejectId } from './decision-dialogs.tsx';
import styles from './proposal-card.module.css';
interface Props {
  proposal: Proposal;
  previous: Threshold | null;
}
function Source({ source }: { source: string }) {
  return /^https?:\/\//i.test(source) ? (
    <a href={source} target="_blank" rel="noreferrer">
      מקור המדד
    </a>
  ) : (
    <>מקור המדד: {source}</>
  );
}
export function ProposalCard({ proposal, previous }: Props) {
  const heading = useId();
  return (
    <article className={styles.card} aria-labelledby={heading}>
      <h2 id={heading}>הצעה לספים מ-{dayOf(proposal.valid_from)}</h2>
      <p>
        מדד החודש: <bdi>{proposal.index_value}</bdi> · <Source source={proposal.source} />
      </p>
      {!previous && <p>לא נמצא סף קודם להשוואה.</p>}
      <ProposalComparison proposal={proposal} previous={previous} />
      <div className={styles.actions}>
        <Button command={{ target: approveId(proposal.id), action: 'show-modal' }}>
          אישור הספים
        </Button>
        <Button
          variant="secondary"
          command={{ target: rejectId(proposal.id), action: 'show-modal' }}
        >
          דחייה
        </Button>
      </div>
      <ApproveDialog proposal={proposal} />
      <RejectDialog proposal={proposal} />
    </article>
  );
}

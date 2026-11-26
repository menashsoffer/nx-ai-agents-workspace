import { useId } from 'react';
import { Button } from '../../../ui/button.tsx';
import type { CategoryRequest } from '../model/decision.ts';
import { DecisionDialog, DECISIONS, dialogId, type DecisionKind } from './decision-dialog.tsx';
import styles from './request.module.css';

interface Props {
  request: CategoryRequest;
  categories: { id: string; name: string }[];
}
const KINDS: { kind: DecisionKind; variant: 'primary' | 'secondary' }[] = [
  { kind: 'approved', variant: 'primary' },
  { kind: 'linked', variant: 'secondary' },
  { kind: 'rejected', variant: 'secondary' },
];

function Source({ reference }: { reference: string | null }) {
  if (!reference) return <>לא צורף מקור</>;
  return /^https?:\/\//i.test(reference) ? (
    <a href={reference} target="_blank" rel="noreferrer">
      פתיחת המקור
    </a>
  ) : (
    <bdi>{reference}</bdi>
  );
}

/** A request: the proposed name, its parent, what it is for and where it came from. */
export function RequestCard({ request, categories }: Props) {
  const heading = useId();
  const parent = request.parent_id
    ? (categories.find((c) => c.id === request.parent_id)?.name ?? 'אינה פעילה או אינה זמינה')
    : 'קטגוריה ראשית';
  const choices = KINDS.filter(({ kind }) => kind !== 'linked' || categories.length > 0);
  return (
    <article className={styles.card} aria-labelledby={heading}>
      <h2 id={heading}>{request.proposed_name}</h2>
      <dl className={styles.facts}>
        <dt>קטגוריית אב</dt>
        <dd>{parent}</dd>
        <dt>מקור</dt>
        <dd>
          <Source reference={request.source_reference} />
        </dd>
      </dl>
      <p>{request.description}</p>
      <div className={styles.actions}>
        {choices.map(({ kind, variant }) => (
          <Button
            key={kind}
            variant={variant}
            command={{ target: dialogId(request.id, kind), action: 'show-modal' }}
          >
            {DECISIONS[kind].action}
          </Button>
        ))}
      </div>
      {choices.map(({ kind }) => (
        <DecisionDialog key={kind} request={request} kind={kind} categories={categories} />
      ))}
    </article>
  );
}

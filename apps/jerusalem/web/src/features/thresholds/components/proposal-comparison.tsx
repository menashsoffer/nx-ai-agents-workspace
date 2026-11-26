import { DataTable } from '../../../ui/data-table.tsx';
import type { Proposal, Threshold } from '../api/proposals.ts';
import { AMOUNT_LABELS, changeLabel, formatMoney, monthLabel } from '../model/comparison.ts';
interface Props {
  proposal: Proposal;
  previous: Threshold | null;
}
type Key = keyof typeof AMOUNT_LABELS;
export function ProposalComparison({ proposal, previous }: Props) {
  const cell = (amount: number) => <bdi>{formatMoney(amount)}</bdi>;
  return (
    <DataTable
      caption={`השוואת הספים — ${monthLabel(proposal.valid_from)}`}
      columns={[
        { id: 'kind', label: 'מסלול' },
        { id: 'previous', label: 'סף נוכחי' },
        { id: 'proposed', label: 'סף מוצע' },
        { id: 'change', label: 'שינוי' },
      ]}
      rows={Object.entries(AMOUNT_LABELS).map(([key, label]) => {
        const next = proposal[key as Key],
          now = previous?.[key as Key];
        return {
          id: key,
          cells: {
            kind: label,
            previous: now === undefined ? 'לא זמין' : cell(now),
            proposed: cell(next),
            change: now === undefined ? '—' : changeLabel(now, next),
          },
        };
      })}
    />
  );
}

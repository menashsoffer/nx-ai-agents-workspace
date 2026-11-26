import type { Outcome } from '../../../data/supplier-changes.ts';
import { Notice, type NoticeTone } from '../../../ui/notice.tsx';
import {
  changeLabel,
  changeValue,
  checkText,
  isRemoval,
  type CheckedChange,
} from '../model/change-checks.ts';

const TONE: Record<Outcome, NoticeTone> = { green: 'success', yellow: 'warning', red: 'error' };
const TITLE: Record<Outcome, string> = {
  green: 'יישמר מיד',
  yellow: 'יישלח לאישור',
  red: 'לא יישמר',
};

interface Props {
  checked: readonly CheckedChange[];
  /** An admin's yellow change is saved at once too (spec section 5). */
  admin: boolean;
}

/** The database's checks of each change, in one colour and a sentence per check (spec 6.6). */
export function ChangeResults({ checked, admin }: Props) {
  return (
    <section aria-label="תוצאות הבדיקה">
      {checked.map(({ change, result }) => {
        const outcome = admin && result.outcome === 'yellow' ? 'green' : result.outcome;
        const label = changeLabel(change.kind, change.contact_kind);
        // A deletion names the detail in its check, so the title only says what is deleted.
        const subject = isRemoval(change.kind, change.value)
          ? `מחיקת ${label}`
          : `${label} (${changeValue(change.kind, change.value)})`;
        return (
          <Notice
            key={`${change.kind}:${change.contact_id ?? change.contact_kind ?? ''}:${change.value}`}
            tone={TONE[result.outcome]}
            title={`${subject}: ${TITLE[outcome]}`}
          >
            {result.checks.map(checkText).join(' ')}
          </Notice>
        );
      })}
    </section>
  );
}

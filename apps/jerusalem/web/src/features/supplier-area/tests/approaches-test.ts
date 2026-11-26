// supplier-approaches-spec-he.md 5: the three groups, the time left, the checks before an
// answer is sent, and the "מה חסר לי" line.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Approach } from '../api/approaches.ts';
import {
  amountProblem,
  cleanAmount,
  dueText,
  groupOf,
  grouped,
  offerSummary,
  stateText,
  waitingTaskText,
} from '../model/approaches.ts';
import { missingTasks } from '../model/missing.ts';
import type { SupplierFile } from '../api/portal.ts';

const approach = (over: Partial<Approach> = {}): Approach => ({
  id: 'a',
  subject: 'ייעוץ תנועה',
  unit_name: 'אגף התנועה',
  approached_on: '2026-11-20',
  respond_by: '2026-11-29',
  needed_by: null,
  cancelled: false,
  open: true,
  answer: null,
  ...over,
});
const answer = (over: Partial<NonNullable<Approach['answer']>> = {}) => ({
  id: 'r',
  answer: 'offer' as const,
  offer_amount: 100,
  offer_includes_vat: true,
  decline_reason: null,
  note: null,
  source: 'portal' as const,
  withdrawn_at: null,
  created_at: '2026-11-21T09:00:00Z',
  ...over,
});

describe('supplier approaches', () => {
  it('puts each approach in its group', () => {
    const groups = grouped([
      approach({ id: 'w' }),
      approach({ id: 'again', answer: answer({ withdrawn_at: '2026-11-21T10:00:00Z' }) }),
      approach({ id: 'done', answer: answer() }),
      approach({ id: 'late', open: false }),
      approach({ id: 'gone', cancelled: true, open: false, answer: answer() }),
    ]);
    assert.deepEqual(
      Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((a) => a.id)])),
      { waiting: ['w', 'again'], answered: ['done'], closed: ['late', 'gone'] },
    );
  });

  it('says how long is left, and marks the last days', () => {
    assert.deepEqual(dueText('2026-11-29', '2026-11-22'), { text: 'נותרו 7 ימים', urgent: false });
    assert.deepEqual(dueText('2026-11-24', '2026-11-22'), { text: 'נותרו 2 ימים', urgent: true });
    assert.deepEqual(dueText('2026-11-23', '2026-11-22'), { text: 'נותר יום אחד', urgent: true });
    assert.deepEqual(dueText('2026-11-22', '2026-11-22'), { text: 'היום עד 23:59', urgent: true });
  });

  it('describes answered and closed approaches', () => {
    assert.equal(stateText(approach({ answer: answer() })), 'הגשתם הצעה ב-21.11.2026');
    assert.equal(
      stateText(approach({ answer: answer({ answer: 'declined', offer_amount: null }) })),
      'השבתם שאינכם מעוניינים',
    );
    assert.equal(stateText(approach({ open: false })), 'המועד עבר בלי תשובה');
    assert.equal(stateText(approach({ cancelled: true })), 'היחידה ביטלה את הבקשה');
  });

  it('tells a bidder whether its offer was chosen (stage C, 25.11)', () => {
    const won = approach({ answer: answer(), result: 'selected' });
    assert.equal(groupOf(won), 'closed');
    assert.equal(stateText(won), 'ההצעה שלכם נבחרה');
    const lost = approach({ answer: answer(), result: 'not_selected' });
    assert.match(stateText(lost), /^ההצעה שלכם לא נבחרה/u);
  });

  it('checks the amount the way the database does', () => {
    for (const ok of ['120000', '120,000.50', ' 1.5 ']) assert.equal(amountProblem(ok), null, ok);
    for (const bad of ['0', '-5', '1.234', 'abc', '', '1234567890'])
      assert.match(amountProblem(bad) ?? '', /סכום חיובי/u, bad);
    assert.equal(cleanAmount(' 120,000.50 '), '120000.50');
    assert.match(offerSummary('120000', true, approach()), /120,000 ₪ כולל מע״מ ל"ייעוץ תנועה"/u);
    assert.match(offerSummary('5', false, approach()), /לא כולל מע״מ.*אחרי 29\.11\.2026/u);
  });

  it('lists waiting approaches first in "מה חסר לי"', () => {
    assert.equal(waitingTaskText([approach({ answer: answer() })]), null);
    assert.equal(waitingTaskText([approach()]), 'פנייה אחת מחכה לתשובה, עד 29.11.2026');
    const two = [approach(), approach({ id: 'b', respond_by: '2026-11-25' })];
    assert.equal(waitingTaskText(two), 'יש 2 פניות שמחכות לתשובה, הקרובה עד 25.11.2026');
    const file = { contacts: [], memberships: [] } as unknown as SupplierFile;
    const tasks = missingTasks(
      { file, proposals: [], documents: [], approaches: two },
      '2026-11-22',
    );
    assert.equal(tasks[0]?.target, 'approaches-title');
  });
});

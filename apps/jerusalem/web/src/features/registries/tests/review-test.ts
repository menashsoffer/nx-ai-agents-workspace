import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { Member } from '../api/registries.ts';
import { dateInput, memberUntil, progress, reviewOrder, untilText } from '../model/review.ts';

const member = (over: Partial<Member>): Member => ({
  id: 'm',
  supplier_id: 's',
  supplier: 'ספק',
  name_as_published: null,
  field: null,
  source_page: null,
  registered_until: null,
  review_status: 'needs_review',
  note: null,
  ...over,
});

it('counts rejected rows as checked', () => {
  assert.equal(
    progress({ needs_review: 3, verified: 5, rejected: 2, expired: 0 }),
    '7 מתוך 10 נבדקו',
  );
});

it('words the registry validity', () => {
  assert.equal(untilText('2026-12-24'), 'בתוקף עד 24.12.2026');
  assert.equal(untilText(null), 'אין תאריך תוקף');
});

it('puts waiting rows first, then by document page', () => {
  const order = reviewOrder([
    member({ id: 'a', review_status: 'verified', source_page: 1 }),
    member({ id: 'b', source_page: 9 }),
    member({ id: 'c', source_page: null }),
    member({ id: 'd', source_page: 2 }),
  ]).map((m) => m.id);
  assert.deepEqual(order, ['d', 'b', 'c', 'a']);
});

it("prefers the supplier's own end date over the registry's", () => {
  assert.equal(
    memberUntil(member({ registered_until: '2026-06-30' }), '2026-12-24'),
    'עד 30.06.2026 (תאריך של הספק)',
  );
  assert.equal(memberUntil(member({}), '2026-12-24'), 'עד 24.12.2026 (לפי המאגר)');
  assert.equal(memberUntil(member({}), null), 'בלי תאריך');
});

it('reads the date field, and an empty field as no date', () => {
  assert.equal(dateInput('2026-12-24'), '2026-12-24');
  assert.equal(dateInput(''), null);
  assert.equal(dateInput(null), null);
});

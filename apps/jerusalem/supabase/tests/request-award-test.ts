// Stage C (25.11): a request ends with a winner whose offer is open, chosen by an editor of
// the unit. The supplier learns it was chosen; others that offered learn they were not.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, USERS } from './access-fixture.ts';
import {
  OTHER_SUPPLIER,
  PEOPLE,
  REQUEST,
  SUPPLIER_ACCOUNT_FIXTURE,
} from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

const WIN = '70000000-0000-0000-0000-000000000001';
const LOSE = '70000000-0000-0000-0000-000000000002';

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Jerusalem',
  });

const award = (db: PGlite, approach: string, note: string | null = null) =>
  db.query('select public.award_engagement_request($1, $2, $3)', [REQUEST, approach, note]);

async function value<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ v: T }>(`select ${sql} as v`, params);
  return rows[0]?.v as T;
}

describe('awarding a request', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
  });
  beforeEach(async () => {
    await db.exec(`
      delete from public.approach_responses;
      update public.engagement_requests set status = 'submitted', awarded_approach_id = null,
        awarded_at = null, awarded_by = null, award_note = null, supplier_id = null;
      delete from public.supplier_approaches;
      insert into public.supplier_approaches (id, request_id, supplier_id, approached_on,
        channel, respond_by) values
        ('${WIN}', '${REQUEST}', '${SUPPLIER}', '${day(-10)}', 'portal', '${day(-1)}'),
        ('${LOSE}', '${REQUEST}', '${OTHER_SUPPLIER}', '${day(-10)}', 'portal', '${day(-1)}');
      insert into public.approach_responses (approach_id, answer, offer_amount,
        offer_includes_vat, source, received_on) values
        ('${WIN}', 'offer', 40000, true, 'staff', '${day(-2)}'),
        ('${LOSE}', 'offer', 45000, true, 'staff', '${day(-2)}');`);
  });
  after(async () => {
    await db.close();
  });

  it('awards an open offer, closes the request and records who did it', async () => {
    const waiting = await as(db, USERS.editor, () =>
      value<Record<string, number>>(db, 'public.home_overview()'),
    );
    assert.equal(waiting.requests_to_award, 1);
    await as(db, USERS.editor, () => award(db, WIN, '  הזולה ביותר  '));
    const { rows } = await db.query<Record<string, unknown>>(
      `select status, supplier_id, awarded_approach_id, awarded_by, award_note
       from public.engagement_requests where id = $1`,
      [REQUEST],
    );
    assert.deepEqual(rows[0], {
      status: 'awarded',
      supplier_id: SUPPLIER,
      awarded_approach_id: WIN,
      awarded_by: USERS.editor,
      award_note: 'הזולה ביותר',
    });
    await as(db, USERS.editor, () => assert.rejects(award(db, LOSE), /request_closed/));
    const after = await as(db, USERS.editor, () =>
      value<Record<string, number>>(db, 'public.home_overview()'),
    );
    assert.equal(after.requests_to_award, 0);
  });

  it('refuses viewers, other approaches, sealed offers and declines', async () => {
    await as(db, USERS.viewer, () => assert.rejects(award(db, WIN), /Not authorized/));
    await db.exec(`update public.supplier_approaches set respond_by = '${day(3)}'
      where id = '${WIN}'`);
    await as(db, USERS.editor, async () => {
      await assert.rejects(award(db, WIN), /approach_award_offer/, 'still sealed');
      await assert.rejects(
        award(db, '70000000-0000-0000-0000-000000000009'),
        /approach_award_offer/,
      );
    });
    assert.equal(
      await as(db, USERS.editor, () =>
        value<Record<string, number>>(db, 'public.home_overview()'),
      ).then((o) => o.requests_to_award),
      0,
      'a request with an approach still before its deadline does not wait for a winner',
    );
    await db.exec(`update public.approach_responses set answer = 'declined',
      offer_amount = null, offer_includes_vat = null, decline_reason = 'no_capacity'
      where approach_id = '${LOSE}'`);
    await as(db, USERS.editor, () => assert.rejects(award(db, LOSE), /approach_award_offer/));
    await as(db, USERS.editor, () =>
      assert.rejects(award(db, LOSE, 'x'.repeat(2001)), /approach_award_note|approach_award_offer/),
    );
  });

  it('tells the winner it was chosen and the other bidder it was not', async () => {
    const result = (person: string, supplier: string) =>
      as(db, person, () =>
        value<{ result: string | null; open: boolean }[]>(db, 'public.portal_approaches($1)', [
          supplier,
        ]),
      ).then((list) => list[0]?.result ?? null);
    assert.equal(await result(PEOPLE.owner, SUPPLIER), null);
    await as(db, USERS.editor, () => award(db, WIN));
    assert.equal(await result(PEOPLE.owner, SUPPLIER), 'selected');
    assert.equal(await result(PEOPLE.otherOwner, OTHER_SUPPLIER), 'not_selected');
  });
});

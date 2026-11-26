// Approaches and answers (supplier-approaches-spec-he.md 7.5): a deadline on each approach,
// an offer sealed until it passes, no late or double answers, and extensions only forward.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, USERS } from './access-fixture.ts';
import {
  OTHER_SUPPLIER,
  PEOPLE,
  REQUEST,
  SUPPLIER_ACCOUNT_FIXTURE,
} from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

type Row = Record<string, unknown>;

async function one(db: PGlite, sql: string, params: unknown[] = []): Promise<Row> {
  const { rows } = await db.query<{ v: Row }>(`select ${sql} as v`, params);
  return rows[0]?.v ?? {};
}

const day = (offset: number) => {
  const date = new Date(Date.now() + offset * 86_400_000);
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
};

interface Approach {
  suppliers?: string[];
  channel?: string;
  due?: string | null;
}
const record = (db: PGlite, { suppliers = [SUPPLIER], channel = 'portal', due }: Approach) =>
  one(db, 'public.record_supplier_approaches($1, $2::uuid[], $3, $4)', [
    REQUEST,
    suppliers,
    channel,
    due === undefined ? day(7) : due,
  ]);

const answer = (db: PGlite, body: Row) =>
  one(db, 'public.portal_answer_approach($1::jsonb)', [JSON.stringify(body)]);

const staffView = (db: PGlite) =>
  one(db, 'public.request_approaches($1)', [REQUEST]) as Promise<unknown> as Promise<Row[]>;

const upload = (db: PGlite, name: string) =>
  db.query("insert into storage.objects (bucket_id, name) values ('supplier-documents', $1)", [
    name,
  ]);

const files = (db: PGlite) =>
  db.query<{ name: string }>("select name from storage.objects where name like '%/offers/%'");

async function approachOf(db: PGlite, supplier: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'select id from public.supplier_approaches where supplier_id = $1',
    [supplier],
  );
  const [row = { id: '' }] = rows;
  return row.id;
}

describe('approaches and answers', () => {
  let db: PGlite;
  let approach = '';
  let offerFile = '';
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('records approaches with a deadline, only for an editor of the unit', async () => {
    await as(db, USERS.viewer, () => assert.rejects(record(db, {}), /Not authorized/));
    await as(db, USERS.editor, async () => {
      await assert.rejects(record(db, { due: day(0) }), /approach_deadline/);
      await assert.rejects(record(db, { due: day(91) }), /approach_deadline/);
      await assert.rejects(record(db, { due: '2026-02-30' }), /approach_deadline/);
      await assert.rejects(record(db, { due: null }), /approach_deadline/, 'portal needs one');
      assert.equal(await record(db, {}), 1);
      assert.equal(await record(db, {}), 0, 'a supplier keeps its first approach');
      const email = { suppliers: [OTHER_SUPPLIER], channel: 'email', due: null };
      assert.equal(await record(db, email), 1);
      await assert.rejects(
        db.query('update public.supplier_approaches set offer_amount = 1'),
        /permission denied/,
        'the old answer columns are closed',
      );
    });
    approach = await approachOf(db, SUPPLIER);
    offerFile = `${SUPPLIER}/offers/${approach}/offer.pdf`;
  });

  it('shows the supplier its approach and nothing about the request', async () => {
    const list = await as(db, PEOPLE.owner, () =>
      one(db, 'public.portal_approaches($1)', [SUPPLIER]),
    );
    const [first = {}] = list as unknown as Row[];
    assert.deepEqual(Object.keys(first).sort(), [
      'answer',
      'approached_on',
      'cancelled',
      'id',
      'needed_by',
      'open',
      'respond_by',
      'result',
      'subject',
      'unit_name',
    ]);
    assert.equal(first.open, true);
    await as(db, PEOPLE.otherOwner, async () => {
      await assert.rejects(
        one(db, 'public.portal_approaches($1)', [SUPPLIER]),
        /supplier_unavailable/,
      );
      await assert.rejects(answer(db, { approach_id: approach }), /supplier_unavailable/);
    });
    const other = await as(db, PEOPLE.otherOwner, () =>
      one(db, 'public.portal_approaches($1)', [OTHER_SUPPLIER]),
    );
    assert.deepEqual(other, [], 'an approach without a deadline is not shown');
  });

  it('takes one offer with its file, and a new one only after a withdrawal', async () => {
    const offer = { approach_id: approach, answer: 'offer', offer_includes_vat: true };
    await as(db, PEOPLE.owner, async () => {
      await assert.rejects(answer(db, { ...offer, offer_amount: '0' }), /approach_amount/);
      await assert.rejects(answer(db, { ...offer, offer_amount: '1.234' }), /approach_amount/);
      await assert.rejects(
        answer(db, { ...offer, offer_amount: '100', offer_includes_vat: 'yes' }),
        /approach_amount/,
      );
      await assert.rejects(
        answer(db, { ...offer, offer_amount: '100', file_path: offerFile }),
        /file_required/,
      );
      await upload(db, offerFile);
      const first = await answer(db, { ...offer, offer_amount: '100', file_path: offerFile });
      await assert.rejects(
        answer(db, { approach_id: approach, answer: 'declined', decline_reason: 'too_short' }),
        /approach_answered/,
      );
      await db.query('select public.portal_withdraw_answer($1)', [first.id]);
      await assert.rejects(
        db.query('select public.portal_withdraw_answer($1)', [first.id]),
        /already_decided/,
      );
      await assert.rejects(
        answer(db, { approach_id: approach, answer: 'declined', decline_reason: 'other' }),
        /reason_required/,
      );
      await answer(db, { ...offer, offer_amount: '120000.50', file_path: offerFile, note: 'x' });
    });
    await as(db, PEOPLE.waiting, () =>
      assert.rejects(answer(db, offer), /supplier_unavailable/, 'a waiting link is no answer'),
    );
  });

  it('keeps the offer sealed from staff until the deadline', async () => {
    const view = await as(db, USERS.editor, () => staffView(db));
    const sealed = view.find((r) => r.supplier_id === SUPPLIER) ?? {};
    assert.equal(sealed.sealed, true);
    assert.deepEqual(Object.keys(sealed.answer as Row).sort(), [
      'answer',
      'created_at',
      'decline_reason',
      'id',
      'received_on',
      'source',
      'withdrawn_at',
    ]);
    for (const user of [USERS.editor, USERS.admin, USERS.auditor]) {
      const seen = await as(db, user, () => files(db));
      assert.equal(seen.rows.length, 0, `${user} reads a sealed offer file`);
    }
    await as(db, USERS.viewer, () => assert.rejects(staffView(db), /Not authorized/));
    const direct = await as(db, USERS.admin, () =>
      db.query('select * from public.approach_responses').then(
        () => 'read',
        () => 'refused',
      ),
    );
    assert.equal(direct, 'refused');
  });

  it('records an answer that came by email, on or before the deadline', async () => {
    const other = await approachOf(db, OTHER_SUPPLIER);
    const staff = (body: Row) =>
      one(db, 'public.record_approach_answer($1::jsonb)', [
        JSON.stringify({
          approach_id: other,
          answer: 'declined',
          decline_reason: 'no_capacity',
          ...body,
        }),
      ]);
    await as(db, USERS.viewer, () => assert.rejects(staff({ received_on: day(0) }), /Not auth/));
    await as(db, USERS.editor, async () => {
      await assert.rejects(staff({ received_on: day(1) }), /date_invalid/);
      await assert.rejects(staff({ received_on: 'soon' }), /date_invalid/);
      const saved = await staff({ received_on: day(0) });
      assert.equal(saved.source, 'staff');
    });
  });

  it('moves the deadline only forward, with a reason', async () => {
    const extend = (due: string, reason = 'ביקשו עוד זמן') =>
      one(db, 'public.extend_approach_deadline($1, $2, $3)', [REQUEST, due, reason]);
    await as(db, USERS.viewer, () => assert.rejects(extend(day(9)), /Not authorized/));
    await as(db, USERS.editor, async () => {
      await assert.rejects(extend(day(9), 'x'), /change_reason_required/);
      await assert.rejects(extend(day(7)), /approach_deadline/);
      assert.equal(await extend(day(9)), 1, 'only the approach with a deadline moves');
    });
    const { rows } = await db.query<{ respond_by: string; deadline_note: string }>(
      'select respond_by::text, deadline_note from public.supplier_approaches where id = $1',
      [approach],
    );
    assert.deepEqual(rows, [{ respond_by: day(9), deadline_note: 'ביקשו עוד זמן' }]);
  });

  it('opens the offer once the deadline has passed, and takes no late answer', async () => {
    await db.exec(`update public.supplier_approaches
      set approached_on = current_date - 9, respond_by = current_date - 1
      where id = '${approach}'`);
    await as(db, PEOPLE.owner, () =>
      assert.rejects(answer(db, { approach_id: approach }), /approach_closed/),
    );
    for (const user of [USERS.editor, USERS.auditor]) {
      const view = await as(db, user, () => staffView(db));
      const open = view.find((r) => r.supplier_id === SUPPLIER) ?? {};
      const answered = open.answer as Row;
      assert.equal(answered.offer_amount, 120000.5);
      assert.equal(answered.file_path, offerFile);
      const seen = await as(db, user, () => files(db));
      assert.equal(seen.rows.length, 1, `${user} reads the opened offer file`);
    }
    const otherUnit = await as(db, USERS.otherViewer, () => files(db));
    assert.equal(otherUnit.rows.length, 0);
  });

  it('closes approaches of a cancelled request', async () => {
    await db.exec(`update public.engagement_requests set status = 'cancelled'
      where id = '${REQUEST}'`);
    await as(db, USERS.editor, () => assert.rejects(record(db, {}), /approach_closed/));
  });
});

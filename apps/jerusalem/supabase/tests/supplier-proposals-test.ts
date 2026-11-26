import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, USERS } from './access-fixture.ts';
import { OTHER_SUPPLIER, PEOPLE, SUPPLIER_ACCOUNT_FIXTURE } from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

type Row = Record<string, unknown>;

async function one(db: PGlite, sql: string, params: unknown[] = []): Promise<Row> {
  const { rows } = await db.query<{ v: Row }>(`select ${sql} as v`, params);
  return rows[0]?.v ?? {};
}

const propose = (db: PGlite, change: Row) =>
  one(db, 'public.portal_propose_change($1::jsonb)', [JSON.stringify(change)]);

async function contactId(db: PGlite, value: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'select id from public.supplier_contacts where value = $1',
    [value],
  );
  return rows[0]?.id ?? '';
}

describe('a supplier proposes a fix to its details', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
    await db.exec(`insert into public.supplier_contacts (supplier_id, kind, value) values
      ('${SUPPLIER}', 'phone', '02-6291111'), ('${OTHER_SUPPLIER}', 'phone', '02-6292222')`);
  });
  after(async () => {
    await db.close();
  });

  it('gives the file each contact id, to name the one to fix', async () => {
    const file = await as(db, PEOPLE.owner, () => one(db, `public.portal_supplier('${SUPPLIER}')`));
    const contacts = file.contacts as Row[];
    assert.ok(contacts.length > 0 && contacts.every((c) => typeof c.id === 'string'));
  });

  it('always waits, even when every check is green, and hides the checks', async () => {
    const phone = await contactId(db, '02-6291111');
    const sent = await as(db, PEOPLE.owner, () =>
      propose(db, {
        supplier_id: SUPPLIER,
        kind: 'contact',
        contact_kind: 'phone',
        contact_id: phone,
        value: '02-6293333',
      }),
    );
    assert.equal(sent.status, 'pending');
    await as(db, PEOPLE.owner, async () => {
      const own = await db.query('select * from public.supplier_change_requests');
      assert.equal(own.rows.length, 0, 'a supplier cannot read the row and its checks');
      const list = (await one(db, `public.portal_changes('${SUPPLIER}')`)) as unknown as Row[];
      assert.equal(list.length, 1);
      const [first = {}] = list;
      assert.equal(first.mine, true);
      assert.equal(first.old_value, '02-6291111');
      assert.equal('checks' in first, false);
    });
    const { rows } = await db.query<Row>(
      'select origin, account_id is not null as linked from public.supplier_change_requests',
    );
    assert.deepEqual(rows, [{ origin: 'supplier', linked: true }]);
  });

  it('refuses a second proposal for the same detail while one waits', async () => {
    const phone = await contactId(db, '02-6291111');
    await as(db, PEOPLE.owner, async () => {
      await assert.rejects(
        propose(db, {
          supplier_id: SUPPLIER,
          kind: 'contact',
          contact_kind: 'phone',
          contact_id: phone,
          value: '02-6294444',
        }),
        /reason:proposal_pending/,
      );
    });
  });

  it('refuses a red change without naming why, and a rename without a reason', async () => {
    await as(db, PEOPLE.owner, async () => {
      await assert.rejects(
        propose(db, { supplier_id: SUPPLIER, kind: 'contact', contact_kind: 'email', value: 'x' }),
        /reason:proposal_blocked/,
      );
      await assert.rejects(
        propose(db, { supplier_id: SUPPLIER, kind: 'rename', value: 'ספק חדש בעמ' }),
        /reason:change_reason_required/,
      );
      const renamed = await propose(db, {
        supplier_id: SUPPLIER,
        kind: 'rename',
        value: 'ספק חדש בעמ',
        reason: 'שינוי שם ברשם החברות',
      });
      assert.equal(renamed.status, 'pending');
    });
  });

  it('refuses another supplier, a waiting link and staff', async () => {
    const change = { supplier_id: OTHER_SUPPLIER, kind: 'rename', value: 'שם', reason: 'סיבה' };
    for (const user of [PEOPLE.owner, PEOPLE.waiting]) {
      await as(db, user, async () => {
        await assert.rejects(propose(db, change), /reason:supplier_unavailable/, user);
        await assert.rejects(
          one(db, `public.portal_changes('${OTHER_SUPPLIER}')`),
          /reason:supplier_unavailable/,
        );
      });
    }
    await as(db, USERS.editor, async () => {
      await assert.rejects(propose(db, change), /reason:sign_in_required|supplier_unavailable/);
    });
  });

  it('lets staff decide it in the same queue, and the supplier sees the outcome', async () => {
    const pending = await as(db, USERS.admin, async () => {
      const { rows } = await db.query<{ id: string; change_kind: string }>(
        "select id, change_kind from public.supplier_change_requests where origin = 'supplier' " +
          'order by created_at',
      );
      return rows;
    });
    assert.equal(pending.length, 2);
    await as(db, USERS.editor, async () => {
      await db.query('select public.decide_supplier_change($1, true, null)', [pending[0]?.id]);
    });
    await as(db, USERS.admin, async () => {
      await db.query("select public.decide_supplier_change($1, false, 'לא תואם לרשם')", [
        pending[1]?.id,
      ]);
    });
    const list = await as(db, PEOPLE.owner, async () => {
      return (await one(db, `public.portal_changes('${SUPPLIER}')`)) as unknown as Row[];
    });
    const seen = list.map(
      (r) => `${String(r.kind)} ${String(r.status)} ${String(r.decision_note)}`,
    );
    assert.deepEqual(seen.toSorted(), ['contact approved null', 'rename rejected לא תואם לרשם']);
    const phone = await contactId(db, '02-6293333');
    assert.ok(phone, 'the approved phone replaced the old one');
  });

  it('lets the person who sent a proposal cancel it', async () => {
    await as(db, PEOPLE.owner, async () => {
      const sent = await propose(db, {
        supplier_id: SUPPLIER,
        kind: 'contact',
        contact_kind: 'website',
        value: 'https://example.co.il',
      });
      await db.query('select public.cancel_supplier_change($1)', [sent.request_id]);
      const list = (await one(db, `public.portal_changes('${SUPPLIER}')`)) as unknown as Row[];
      assert.equal(list.find((r) => r.id === sent.request_id)?.status, 'cancelled');
    });
  });
});

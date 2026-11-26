// "המשתמשים שלנו" (supplier-portal spec 6.8): an owner invites and removes the supplier's
// people, a member cannot, and the last owner always stays.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER } from './access-fixture.ts';
import { OTHER_SUPPLIER, PEOPLE, SUPPLIER_ACCOUNT_FIXTURE } from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

type Row = Record<string, unknown>;

const COLLEAGUE = '10000000-0000-0000-0000-0000000000b1';

async function one(db: PGlite, sql: string, params: unknown[] = []): Promise<Row> {
  const { rows } = await db.query<{ v: Row }>(`select ${sql} as v`, params);
  return rows[0]?.v ?? {};
}

const invite = (db: PGlite, email: string, more: { role?: string; supplier?: string } = {}) =>
  one(db, 'public.portal_invite_member($1::jsonb)', [
    JSON.stringify({ supplier_id: more.supplier ?? SUPPLIER, email, role: more.role ?? 'member' }),
  ]);

const members = (db: PGlite) => one(db, 'public.portal_members($1)', [SUPPLIER]);

async function accountOf(db: PGlite, user: string) {
  const { rows } = await db.query<{ id: string; status: string; decision_note: string | null }>(
    'select id, status, decision_note from public.supplier_accounts where user_id = $1',
    [user],
  );
  const [row = { id: '', status: '', decision_note: null }] = rows;
  return row;
}

describe('supplier members', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
    await db.exec(`insert into auth.users (id) values ('${COLLEAGUE}');
      insert into public.portal_people (user_id, first_name, last_name)
        values ('${COLLEAGUE}', 'נועה', 'בר');`);
  });
  after(async () => {
    await db.close();
  });

  it('lets an owner invite any address once, and refuses everyone else', async () => {
    const email = `${COLLEAGUE}@example.test`;
    const first = await as(db, PEOPLE.owner, () => invite(db, ` ${email.toUpperCase()} `));
    const again = await as(db, PEOPLE.owner, () => invite(db, email, { role: 'owner' }));
    assert.equal(again, first, 'the open invite is reused, with the new role');
    await as(db, PEOPLE.owner, async () => {
      await assert.rejects(invite(db, 'not-an-email'), /Invalid email/);
      await assert.rejects(invite(db, 'a@b.co', { role: 'admin' }), /bad_choice/);
      await assert.rejects(invite(db, 'a@b.co', { supplier: OTHER_SUPPLIER }), /Not authorized/);
    });
    await as(db, PEOPLE.waiting, () =>
      assert.rejects(invite(db, 'a@b.co'), /Not authorized/, 'a waiting link is no owner'),
    );
    const listed = await as(db, PEOPLE.owner, () => members(db));
    assert.deepEqual(
      (listed.invites as Row[]).map((i) => [i.email, i.role]),
      [[email, 'owner']],
    );
  });

  it('links the invitee as soon as they accept with that email', async () => {
    await as(db, COLLEAGUE, async () => {
      const me = await one(db, 'public.portal_me()');
      const [open = {}] = me.invites as Row[];
      await one(db, 'public.portal_accept_invite($1)', [open.id]);
    });
    const listed = await as(db, PEOPLE.owner, () => members(db));
    assert.deepEqual(
      (listed.members as Row[]).map((m) => [m.first_name, m.role, m.is_me]),
      [
        ['דנה', 'owner', true],
        ['נועה', 'owner', false],
      ],
    );
    assert.deepEqual(listed.invites, []);
  });

  it('lets an owner withdraw an open invite', async () => {
    const id = await as(db, PEOPLE.owner, () => invite(db, 'later@example.co.il'));
    await as(db, PEOPLE.otherOwner, () =>
      assert.rejects(one(db, 'public.portal_cancel_invite($1)', [id]), /Not authorized/),
    );
    await as(db, PEOPLE.owner, async () => {
      await one(db, 'public.portal_cancel_invite($1)', [id]);
      await assert.rejects(one(db, 'public.portal_cancel_invite($1)', [id]), /already_decided/);
      assert.deepEqual((await members(db)).invites, []);
    });
  });

  it('removes a colleague, but never the last owner', async () => {
    const colleague = await accountOf(db, COLLEAGUE);
    const owner = await accountOf(db, PEOPLE.owner);
    await as(db, PEOPLE.otherOwner, () =>
      assert.rejects(one(db, 'public.portal_remove_member($1)', [colleague.id]), /Not authorized/),
    );
    await as(db, PEOPLE.owner, () => one(db, 'public.portal_remove_member($1)', [colleague.id]));
    const removed = await accountOf(db, COLLEAGUE);
    assert.equal(removed.status, 'revoked');
    assert.equal(removed.decision_note, 'הוסר בידי מורשה של הספק');
    await as(db, PEOPLE.owner, async () => {
      await assert.rejects(one(db, 'public.portal_remove_member($1)', [owner.id]), /Last owner/);
      await assert.rejects(
        one(db, 'public.portal_remove_member($1)', [colleague.id]),
        /already_decided/,
      );
    });
  });

  it('lets a member see nothing of the list', async () => {
    await db.exec(`update public.supplier_accounts set status = 'active', role = 'member'
      where user_id = '${COLLEAGUE}'`);
    await as(db, COLLEAGUE, () => assert.rejects(members(db), /Not authorized/));
  });
});

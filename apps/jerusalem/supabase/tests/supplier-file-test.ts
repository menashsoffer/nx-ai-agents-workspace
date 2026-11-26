import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, USERS, VERSION } from './access-fixture.ts';
import { OTHER_SUPPLIER, PEOPLE, SUPPLIER_ACCOUNT_FIXTURE } from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

// INVITED signs in with the supplier's own office address; STRANGER with another one.
const INVITED = '10000000-0000-0000-0000-0000000000c1';
const STRANGER = '10000000-0000-0000-0000-0000000000c2';
const OFFICE = `${INVITED}@example.test`;

type Row = Record<string, unknown>;

async function value<T = Row>(db: PGlite, sql: string): Promise<T> {
  const { rows } = await db.query<{ v: T }>(`select ${sql} as v`);
  return rows[0]?.v as T;
}

describe('invites and the supplier’s own file', () => {
  let db: PGlite;
  let invite = '';
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
    await db.exec(`insert into auth.users (id) values ('${INVITED}'), ('${STRANGER}');
      insert into public.portal_people (user_id, first_name, last_name) values
        ('${INVITED}', 'אורי', 'שם'), ('${STRANGER}', 'זר', 'זר');
      insert into public.supplier_contacts (supplier_id, kind, value, status) values
        ('${SUPPLIER}', 'email', '${OFFICE}', 'current'),
        ('${SUPPLIER}', 'phone', '02-6291111', 'current'),
        ('${SUPPLIER}', 'email', 'old@example.co.il', 'outdated');
      update public.suppliers set note = 'הערה פנימית' where id = '${SUPPLIER}';
      insert into public.supplier_names (supplier_id, name) values ('${SUPPLIER}', 'שם מסחרי');
      insert into public.registry_fields (id, registry_id, source_text) values
        ('30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001',
          'ייעוץ ארגוני');
      insert into public.memberships (supplier_id, registry_version_id, registry_field_id,
        registered_until) values ('${SUPPLIER}', '${VERSION}',
          '30000000-0000-0000-0000-000000000003', '2027-12-31'),
        ('${SUPPLIER}', '${VERSION}', null, null);
      update public.memberships set review_status = 'removed' where registry_field_id is null`);
  });
  after(async () => {
    await db.close();
  });

  it('lets staff invite only through an email the supplier already has', async () => {
    await as(db, USERS.viewer, async () => {
      await assert.rejects(
        value(db, `public.invite_supplier_account('${SUPPLIER}', '${OFFICE}')`),
        /Not authorized/,
      );
    });
    await as(db, USERS.editor, async () => {
      await assert.rejects(
        value(db, `public.invite_supplier_account('${SUPPLIER}', 'new@example.co.il')`),
        /invite_email_unknown/,
      );
      await assert.rejects(
        value(
          db,
          `public.invite_supplier_account('40000000-0000-0000-0000-0000000000ff',
          '${OFFICE}')`,
        ),
        /supplier_unavailable/,
      );
      invite = await value<string>(
        db,
        `public.invite_supplier_account('${SUPPLIER}',
        ' ${OFFICE.toUpperCase()} ')`,
      );
      const again = await value<string>(
        db,
        `public.invite_supplier_account('${SUPPLIER}',
        '${OFFICE}')`,
      );
      assert.equal(again, invite);
    });
  });

  it('shows the invite only to its own email, and lets only that person accept', async () => {
    const theirs = await as(db, INVITED, () => value(db, 'public.portal_me()'));
    assert.deepEqual(
      (theirs.invites as Row[]).map((i) => i.supplier_name),
      ['ספק'],
    );
    await as(db, STRANGER, async () => {
      assert.deepEqual((await value(db, 'public.portal_me()')).invites, []);
      await assert.rejects(
        value(db, `public.portal_accept_invite('${invite}')`),
        /invite_unavailable/,
      );
    });
    await as(db, INVITED, async () => {
      assert.equal((await value(db, `public.portal_accept_invite('${invite}')`)).status, 'active');
      await assert.rejects(
        value(db, `public.portal_accept_invite('${invite}')`),
        /invite_unavailable/,
      );
    });
  });

  it('turns a waiting link into an active one when the invite is accepted', async () => {
    await db.exec(`insert into public.portal_people (user_id, first_name, last_name)
      values ('${PEOPLE.waiting}', 'מיכל', 'לוי');
      insert into public.supplier_contacts (supplier_id, kind, value)
        values ('${SUPPLIER}', 'email', '${PEOPLE.waiting}@example.test')`);
    const second = await as(db, USERS.manager, () =>
      value<string>(
        db,
        `public.invite_supplier_account('${SUPPLIER}',
        '${PEOPLE.waiting}@example.test')`,
      ),
    );
    await as(db, PEOPLE.waiting, () => value(db, `public.portal_accept_invite('${second}')`));
    const ids = await as(db, PEOPLE.waiting, () =>
      db.query('select private.my_supplier_ids() as id'),
    );
    assert.deepEqual(ids.rows, [{ id: SUPPLIER }]);
  });

  it('gives the supplier its file without internal data', async () => {
    const file = await as(db, INVITED, () => value(db, `public.portal_supplier('${SUPPLIER}')`));
    assert.equal(file.name, 'ספק');
    assert.equal(file.role, 'owner');
    assert.equal('note' in file || 'review_status' in file || 'audit' in file, false);
    assert.deepEqual(file.other_names, ['שם מסחרי']);
    const contacts = (file.contacts as Row[]).map((c) => String(c.value));
    assert.deepEqual(
      contacts.toSorted(),
      ['02-6291111', `${PEOPLE.waiting}@example.test`, OFFICE, 'office@example.co.il'].toSorted(),
    );
    assert.deepEqual(file.identifiers, [
      { scheme: 'company', value: '512345678', verified: false },
      { scheme: 'personal_id', value: '012345678', verified: false },
    ]);
    assert.deepEqual(file.memberships, [
      {
        registry: 'מאגר',
        unit: 'אגף 1',
        field: 'ייעוץ ארגוני',
        registered_from: null,
        registered_until: '2027-12-31',
        document_url: null,
      },
    ]);
  });

  it('shows a member only the last 4 digits of a personal ID', async () => {
    await db.exec(`update public.supplier_accounts set role = 'member'
      where user_id = '${INVITED}'`);
    const file = await as(db, INVITED, () => value(db, `public.portal_supplier('${SUPPLIER}')`));
    assert.deepEqual((file.identifiers as Row[])[1], {
      scheme: 'personal_id',
      value: '*****5678',
      verified: false,
    });
  });

  it('refuses another supplier’s file', async () => {
    await as(db, PEOPLE.otherOwner, async () => {
      await assert.rejects(
        value(db, `public.portal_supplier('${SUPPLIER}')`),
        /supplier_unavailable/,
      );
      assert.equal(
        (await value(db, `public.portal_supplier('${OTHER_SUPPLIER}')`)).name,
        'ספק אחר',
      );
    });
  });

  it('lets staff see the invites, and suppliers not', async () => {
    const staff = await as(db, USERS.viewer, () =>
      db.query('select 1 from public.supplier_invites'),
    );
    assert.equal(staff.rows.length, 2);
    const supplier = await as(db, INVITED, () => db.query('select 1 from public.supplier_invites'));
    assert.equal(supplier.rows.length, 0);
  });
});

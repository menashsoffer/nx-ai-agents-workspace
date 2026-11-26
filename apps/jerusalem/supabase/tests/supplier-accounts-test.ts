import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, USERS } from './access-fixture.ts';
import { OTHER_SUPPLIER, PEOPLE, SUPPLIER_ACCOUNT_FIXTURE } from './supplier-account-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

async function mySuppliers(db: PGlite, user: string): Promise<string[]> {
  return as(db, user, async () => {
    const result = await db.query<{ id: string }>('select private.my_supplier_ids() as id');
    return result.rows.map((row) => row.id);
  });
}

describe('supplier accounts', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('acts only for the supplier of an active link', async () => {
    assert.deepEqual(await mySuppliers(db, PEOPLE.owner), [SUPPLIER]);
    assert.deepEqual(await mySuppliers(db, PEOPLE.otherOwner), [OTHER_SUPPLIER]);
    assert.deepEqual(await mySuppliers(db, PEOPLE.waiting), []);
    assert.deepEqual(await mySuppliers(db, USERS.admin), []);
  });

  it('drops the link once the supplier is no longer active', async () => {
    await db.exec(`update public.suppliers set status = 'inactive', status_reason = 'נסגר',
      status_changed_on = current_date where id = '${OTHER_SUPPLIER}'`);
    assert.deepEqual(await mySuppliers(db, PEOPLE.otherOwner), []);
    await db.exec(`update public.suppliers set status = 'active', status_reason = null,
      status_changed_on = null where id = '${OTHER_SUPPLIER}'`);
  });

  it('shows a person only their own links and details', async () => {
    await as(db, PEOPLE.owner, async () => {
      assert.equal(await count(db, 'select 1 from public.supplier_accounts'), 1);
      assert.equal(await count(db, 'select 1 from public.portal_people'), 1);
    });
    await as(db, PEOPLE.waiting, async () => {
      assert.equal(await count(db, 'select 1 from public.supplier_accounts'), 1);
      assert.equal(await count(db, 'select 1 from public.portal_people'), 0);
    });
  });

  it('shows staff and the auditor every link, for the supplier page', async () => {
    for (const user of [USERS.viewer, USERS.auditor, USERS.admin]) {
      await as(db, user, async () => {
        assert.equal(await count(db, 'select 1 from public.supplier_accounts'), 3);
        assert.equal(await count(db, 'select 1 from public.portal_people'), 2);
      });
    }
    await as(db, USERS.pending, async () => {
      assert.equal(await count(db, 'select 1 from public.supplier_accounts'), 0);
    });
  });

  it('lets nobody write a link directly, not even an admin', async () => {
    for (const user of [PEOPLE.waiting, USERS.admin]) {
      await as(db, user, async () => {
        await assert.rejects(
          db.exec(`insert into public.supplier_accounts (user_id, supplier_id, role, method)
            values ('${user}', '${OTHER_SUPPLIER}', 'owner', 'email_match')`),
          /permission denied/,
        );
        await assert.rejects(
          db.exec(`update public.supplier_accounts set status = 'active'`),
          /permission denied/,
        );
      });
    }
  });

  it('lets a person write their own details and no one else’s', async () => {
    await as(db, PEOPLE.waiting, async () => {
      await db.exec(`insert into public.portal_people (user_id, first_name, last_name, phone)
        values ('${PEOPLE.waiting}', 'מיכל', 'לוי', '0521234567')`);
      await assert.rejects(
        db.exec(`insert into public.portal_people (user_id, first_name, last_name)
          values ('${PEOPLE.otherOwner}', 'זר', 'זר')`),
        /row-level security/,
      );
      await db.exec(`update public.portal_people set first_name = 'שונה'`);
    });
    const names = await db.query<{ first_name: string }>(
      'select first_name from public.portal_people order by user_id',
    );
    assert.deepEqual(
      names.rows.map((row) => row.first_name),
      ['דנה', 'שונה', 'רון'],
    );
  });

  it('keeps one live link per person and supplier', async () => {
    await assert.rejects(
      db.exec(`insert into public.supplier_accounts (user_id, supplier_id, role, method,
        proof_path) values ('${PEOPLE.waiting}', '${SUPPLIER}', 'member', 'document', 'x.pdf')`),
      /supplier_accounts_live_idx/,
    );
  });

  it('requires proof for a document link and a note to reject or revoke', async () => {
    await assert.rejects(
      db.exec(`insert into public.supplier_accounts (user_id, supplier_id, role, method)
        values ('${PEOPLE.owner}', '${OTHER_SUPPLIER}', 'member', 'document')`),
      /supplier_accounts_check/,
    );
    await assert.rejects(
      db.exec(`update public.supplier_accounts set status = 'revoked'
        where user_id = '${PEOPLE.owner}'`),
      /supplier_accounts_check/,
    );
    await db.exec(`update public.supplier_accounts set status = 'revoked',
      decision_note = 'הדוא"ל לא שייך לספק' where user_id = '${PEOPLE.owner}'`);
    assert.deepEqual(await mySuppliers(db, PEOPLE.owner), []);
  });
});

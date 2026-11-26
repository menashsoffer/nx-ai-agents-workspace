import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { SUPPLIER, USERS } from './access-fixture.ts';
import { OTHER_SUPPLIER, PEOPLE, SUPPLIER_ACCOUNT_FIXTURE } from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

type Row = Record<string, unknown>;

function accounts(db: PGlite, user: string, supplier = SUPPLIER): Promise<Row[]> {
  return as(db, user, async () => {
    const { rows } = await db.query<{ v: Row[] }>('select public.supplier_area_accounts($1) as v', [
      supplier,
    ]);
    return rows[0]?.v ?? [];
  });
}

describe('the supplier area for staff', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('lists who is linked to one supplier, for any staff member and the auditor', async () => {
    for (const user of [USERS.viewer, USERS.editor, USERS.admin, USERS.auditor]) {
      const rows = await accounts(db, user);
      const seen = rows.map(
        (r) => `${String(r.status)} ${String(r.method)} ${String(r.first_name)}`,
      );
      assert.deepEqual(seen.toSorted(), ['active email_match דנה', 'pending document null'], user);
      assert.ok(
        rows.every((r) => 'email' in r && 'decision_note' in r),
        user,
      );
    }
    assert.equal((await accounts(db, USERS.viewer, OTHER_SUPPLIER)).length, 1);
  });

  it('refuses a supplier account and someone not yet active', async () => {
    for (const user of [PEOPLE.owner, USERS.pending, USERS.blocked]) {
      await assert.rejects(accounts(db, user), /Not authorized/, user);
    }
  });

  it('counts the links to check for the admin only', async () => {
    const counters = (user: string) =>
      as(db, user, async () => {
        const { rows } = await db.query<{ v: Row }>('select public.admin_overview() as v');
        return rows[0]?.v ?? {};
      });
    assert.equal((await counters(USERS.admin)).supplier_links_pending, 2);
    assert.equal((await counters(USERS.manager)).supplier_links_pending, undefined);
  });
});

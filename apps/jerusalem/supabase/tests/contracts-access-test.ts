// Row level security on contracts, committee decisions and contract changes, by role, and the
// successful paths of revoke_role.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, UNIT_1, UNIT_2, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

const OTHER_CONTRACT = '60000000-0000-4000-8000-000000000002';

// Users may not choose ids: the column grants leave id to its default.
const insertContract = (unit: string) => `
  insert into public.contracts (unit_id, supplier_id, subject, starts_on, original_value,
    value_includes_vat) values ('${unit}', '${SUPPLIER}', 'ייעוץ', '2026-01-01', 1000, false)
  returning id`;
const insertDecision = (contract: string) => `
  insert into public.committee_decisions (committee, contract_id, decided_on, decision)
  values ('tenders', '${contract}', '2026-02-01', 'approved')`;
const insertChange = (contract: string) => `
  insert into public.contract_changes (contract_id, kind, amount, effective_on)
  values ('${contract}', 'increase_existing_item', 100, '2026-03-01')`;

describe('contract records by role', () => {
  let db: PGlite;
  let contract = '';
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.contracts (id, unit_id, supplier_id, subject, starts_on,
      original_value, value_includes_vat) values ('${OTHER_CONTRACT}', '${UNIT_2}',
      '${SUPPLIER}', 'ייעוץ', '2026-01-01', 1000, false)`);
  });
  after(async () => {
    await db.close();
  });

  it('lets only a unit manager record a contract in their own unit', async () => {
    for (const user of [USERS.editor, USERS.viewer, USERS.otherViewer]) {
      await as(db, user, async () => {
        await assert.rejects(db.query(insertContract(UNIT_1)), /row-level security/);
      });
    }
    await as(db, USERS.manager, async () => {
      await assert.rejects(db.query(insertContract(UNIT_2)), /row-level security/);
      const created = await db.query<{ id: string }>(insertContract(UNIT_1));
      contract = created.rows[0]?.id ?? '';
    });
    assert.notEqual(contract, '');
  });

  it('records committee decisions and changes through the contract unit', async () => {
    await as(db, USERS.editor, async () => {
      await assert.rejects(db.query(insertDecision(contract)), /row-level security/);
      await assert.rejects(db.query(insertChange(contract)), /row-level security/);
    });
    await as(db, USERS.manager, async () => {
      await db.query(insertDecision(contract));
      await db.query(insertChange(contract));
      await assert.rejects(db.query(insertDecision(OTHER_CONTRACT)), /row-level security/);
      await assert.rejects(db.query(insertChange(OTHER_CONTRACT)), /row-level security/);
    });
  });

  it('shows each unit only its own contracts, decisions and changes; admins see all', async () => {
    const tables = ['contracts', 'committee_decisions', 'contract_changes'];
    const seen = async (user: string) =>
      as(db, user, async () => {
        const counts: number[] = [];
        for (const table of tables) counts.push(await count(db, `select * from public.${table}`));
        return counts;
      });
    assert.deepEqual(await seen(USERS.viewer), [1, 1, 1]);
    assert.deepEqual(await seen(USERS.otherViewer), [1, 0, 0]);
    assert.deepEqual(await seen(USERS.admin), [2, 1, 1]);
    assert.deepEqual(await seen(USERS.pending), [0, 0, 0]);
    assert.deepEqual(await seen(USERS.blocked), [0, 0, 0]);
  });

  it('lets the unit manager, not the editor, update a contract', async () => {
    const update = `update public.contracts set status = 'ended' where id = '${contract}'
      returning id`;
    await as(db, USERS.editor, async () => {
      assert.equal((await db.query(update)).rows.length, 0);
    });
    await as(db, USERS.manager, async () => {
      assert.equal((await db.query(update)).rows.length, 1);
    });
  });
});

describe('revoke_role', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  const grantOf = async (user: string, role: string) => {
    const result = await db.query<{ id: string }>(
      'select id from public.role_grants where user_id = $1 and role = $2 and revoked_at is null',
      [user, role],
    );
    const id = result.rows[0]?.id;
    assert.ok(id, `${role} grant of ${user}`);
    return id;
  };

  it('lets a unit manager revoke a viewer in their unit but not another manager', async () => {
    const viewer = await grantOf(USERS.viewer, 'viewer');
    const manager = await grantOf(USERS.manager, 'unit_manager');
    await as(db, USERS.manager, async () => {
      await assert.rejects(db.query('select public.revoke_role($1)', [manager]), /not authorized/);
      await db.query('select public.revoke_role($1)', [viewer]);
      await assert.rejects(db.query('select public.revoke_role($1)', [viewer]), /not found/);
    });
    assert.equal(
      await count(
        db,
        `select 1 from public.role_grants where id = '${viewer}' and revoked_at is null`,
      ),
      0,
    );
  });

  it('lets an admin revoke another admin while one remains', async () => {
    await db.query(`insert into public.role_grants (user_id, role) values ($1, 'admin')`, [
      USERS.auditor,
    ]);
    const second = await grantOf(USERS.auditor, 'admin');
    await as(db, USERS.admin, async () => {
      await db.query('select public.revoke_role($1)', [second]);
    });
    await as(db, USERS.viewer, async () => {
      const admin = `select id from public.role_grants where role = 'admin'`;
      assert.equal(await count(db, admin), 0, 'a viewer does not see admin grants');
    });
  });
});

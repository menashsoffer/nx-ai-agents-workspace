// Saving, deciding and reading supplier changes (supplier-edit-checks-spec-he.md section 5).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, SUPPLIER, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';
import {
  BARE,
  CHANGE_FIXTURE,
  NEIGHBOUR,
  PHONE,
  TRADER,
  VERIFIED,
  decideChange,
  failure,
  submitChange,
} from './supplier-change-fixture.ts';

async function supplier(db: PGlite, id: string) {
  const { rows } = await db.query<{ display_name: string; entity_kind: string; review: string }>(
    'select display_name, entity_kind, review_status as review from public.suppliers where id=$1',
    [id],
  );
  return rows[0];
}

describe('supplier change requests', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(CHANGE_FIXTURE);
  });
  after(async () => db.close());

  it('saves a green rename at once, keeps the old name and asks for a review', async () => {
    const saved = await as(db, USERS.editor, () =>
      submitChange(db, { supplier_id: SUPPLIER, kind: 'rename', value: 'ספקים', reason: 'כתיב' }),
    );
    assert.equal(saved.status, 'applied');
    assert.deepEqual(await supplier(db, SUPPLIER), {
      display_name: 'ספקים',
      entity_kind: 'unknown',
      review: 'needs_review',
    });
    const former = `select 1 from public.supplier_names where name = 'ספק' and kind = 'former_name'`;
    assert.equal(await count(db, former), 1);
  });

  it('needs a reason for a rename and refuses a red change', async () => {
    const rename = { supplier_id: TRADER, kind: 'rename' as const, value: 'דנה כהן יעוץ' };
    await as(db, USERS.editor, async () => {
      assert.match(await failure(submitChange(db, rename)), /reason:change_reason_required/);
      const bad = { ...rename, value: 'א', reason: 'שם קצר' };
      assert.match(await failure(submitChange(db, bad)), /reason:change_blocked/);
    });
  });

  it('keeps a yellow rename waiting for an admin', async () => {
    const change = {
      supplier_id: TRADER,
      kind: 'rename' as const,
      value: 'דנה כהן יעוץ',
      reason: 'לפי חשבונית',
    };
    const saved = await as(db, USERS.editor, () => submitChange(db, change));
    assert.equal(saved.status, 'pending');
    assert.equal((await supplier(db, TRADER))?.display_name, 'דנה כהן ייעוץ');
    const approve = (user: string) =>
      as(db, user, () => failure(decideChange(db, saved.request_id, { approve: true })));
    assert.match(await approve(USERS.manager), /^42501 Not authorized/);
    assert.match(await approve(USERS.editor), /^42501/);
    assert.equal(await approve(USERS.admin), 'no error');
    assert.equal((await supplier(db, TRADER))?.display_name, 'דנה כהן יעוץ');
    assert.match(await approve(USERS.admin), /reason:already_decided/);
  });

  it('saves an admin change at once, with a reason when it is yellow', async () => {
    await as(db, USERS.admin, async () => {
      const kind = { supplier_id: BARE, kind: 'entity_kind' as const, value: 'company' };
      assert.match(await failure(submitChange(db, kind)), /reason:change_reason_required/);
      const saved = await submitChange(db, { ...kind, reason: 'לפי השם' });
      assert.equal(saved.status, 'approved');
    });
    assert.equal((await supplier(db, BARE))?.entity_kind, 'company');
  });

  it('lets another editor decide a contact change, never the one who asked', async () => {
    const shared = {
      supplier_id: VERIFIED,
      kind: 'contact' as const,
      contact_kind: 'email',
      value: 'office@urban.example',
    };
    const saved = await as(db, USERS.editor, () => submitChange(db, shared));
    assert.equal(saved.status, 'pending');
    const decide = (user: string, approve: boolean, note?: string) =>
      as(db, user, () =>
        failure(decideChange(db, saved.request_id, note ? { approve, note } : { approve })),
      );
    assert.match(await decide(USERS.editor, true), /reason:self_approval/);
    assert.match(await decide(USERS.viewer, true), /^42501/);
    assert.match(await decide(USERS.manager, false), /reason:reason_required/);
    assert.equal(await decide(USERS.manager, true), 'no error');
    const current = `select 1 from public.supplier_contacts
      where supplier_id = '${VERIFIED}' and normalized_value = 'office@urban.example'`;
    assert.equal(await count(db, current), 1);
  });

  it('rejects with a note, cancels only its own and refuses a stale approval', async () => {
    const phone = (value: string) => ({
      supplier_id: SUPPLIER,
      kind: 'contact' as const,
      contact_kind: 'phone',
      contact_id: PHONE,
      value,
    });
    const first = await as(db, USERS.editor, () =>
      submitChange(db, phone('026291111')).catch(() => null),
    );
    assert.equal(first, null);
    await as(db, USERS.editor, () =>
      submitChange(db, {
        supplier_id: NEIGHBOUR,
        kind: 'entity_kind',
        value: 'company',
        reason: 'ח"פ',
      }),
    );
    const waiting = await as(db, USERS.manager, () =>
      submitChange(db, { supplier_id: NEIGHBOUR, kind: 'rename', value: 'אורבן', reason: 'קיצור' }),
    );
    assert.match(
      await as(db, USERS.editor, () =>
        failure(db.query('select public.cancel_supplier_change($1)', [waiting.request_id])),
      ),
      /reason:already_decided/,
    );
    await as(db, USERS.admin, () =>
      decideChange(db, waiting.request_id, { approve: false, note: 'שם לא מלא' }),
    );
    const late = await as(db, USERS.manager, () =>
      submitChange(db, {
        supplier_id: NEIGHBOUR,
        kind: 'rename',
        value: 'אורבן בע"מ',
        reason: 'קיצור',
      }),
    );
    await as(db, USERS.admin, () =>
      submitChange(db, {
        supplier_id: NEIGHBOUR,
        kind: 'rename',
        value: 'אורבן תכנון',
        reason: 'מסמך',
      }),
    );
    assert.match(
      await as(db, USERS.admin, () =>
        failure(decideChange(db, late.request_id, { approve: true })),
      ),
      /reason:change_outdated/,
    );
    await as(db, USERS.manager, () =>
      db.query('select public.cancel_supplier_change($1)', [late.request_id]),
    );
  });

  it('shows requests to their owner, the deciders and the auditor only', async () => {
    const visible = (user: string, kind: string) =>
      as(db, user, () =>
        count(db, `select 1 from public.supplier_change_requests where change_kind = '${kind}'`),
      );
    const renames = await count(
      db,
      `select 1 from public.supplier_change_requests where change_kind = 'rename'`,
    );
    assert.equal(await visible(USERS.viewer, 'rename'), 0);
    assert.equal(await visible(USERS.viewer, 'contact'), 0);
    assert.equal(await visible(USERS.auditor, 'rename'), renames);
    assert.equal(await visible(USERS.admin, 'rename'), renames);
    assert.equal(await visible(USERS.editor, 'rename'), 2);
    assert.equal(await visible(USERS.manager, 'contact'), 1);
  });

  it('closes direct writes to the name and kind', async () => {
    await as(db, USERS.editor, async () => {
      for (const column of ['display_name', 'entity_kind']) {
        const sql = `update public.suppliers set ${column} = 'company' where id = '${SUPPLIER}'`;
        assert.match(await failure(db.exec(sql)), /^42501/);
      }
      const insert = `insert into public.supplier_change_requests (supplier_id, change_kind,
        new_value, checks, outcome, status) values ('${SUPPLIER}', 'rename', 'x', '[]', 'green',
        'applied')`;
      assert.match(await failure(db.exec(insert)), /^42501/);
    });
    assert.match(
      await as(db, USERS.viewer, () =>
        failure(
          db.query('select public.rename_supplier($1::jsonb)', [
            JSON.stringify({ supplier_id: SUPPLIER, display_name: 'שם' }),
          ]),
        ),
      ),
      /^42501/,
    );
  });

  it('lets no signed-in user skip the checks through the older write functions', async () => {
    const calls = [
      ['rename_supplier', { supplier_id: SUPPLIER, display_name: 'שם בלי בדיקה' }],
      ['replace_supplier_contact', { supplier_id: SUPPLIER, kind: 'phone', value: '02-6297777' }],
    ] as const;
    for (const user of [USERS.admin, USERS.editor]) {
      for (const [name, payload] of calls) {
        const sql = `select public.${name}($1::jsonb)`;
        const result = await as(db, user, () => failure(db.query(sql, [JSON.stringify(payload)])));
        assert.match(result, /^42501.*permission denied/, `${name} by ${user}`);
      }
    }
    const gone = await db.query("select to_regprocedure('public.update_supplier(jsonb)') as fn");
    assert.equal((gone.rows[0] as { fn: string | null }).fn, null);
  });
});

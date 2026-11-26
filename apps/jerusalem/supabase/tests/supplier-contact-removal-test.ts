// Removing a supplier's contact through the edit checks (migration 20261123000000).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';
import {
  CHANGE_FIXTURE,
  VERIFIED,
  checkChange,
  decideChange,
  failure,
  submitChange,
} from './supplier-change-fixture.ts';

const PHONE_A = '52000000-0000-0000-0000-000000000001';
const PHONE_B = '52000000-0000-0000-0000-000000000002';
const ADDRESS = '52000000-0000-0000-0000-000000000003';
const EMAIL = '52000000-0000-0000-0000-000000000004';
const CONTACTS = `
  insert into public.supplier_contacts (id, supplier_id, kind, value, is_primary) values
    ('${PHONE_A}', '${VERIFIED}', 'phone', '054-2244973', true),
    ('${PHONE_B}', '${VERIFIED}', 'phone', '054-5990250', false),
    ('${ADDRESS}', '${VERIFIED}', 'address', 'בן אביגדור 26, תל אביב-יפו', false),
    ('${EMAIL}', '${VERIFIED}', 'email', 'office@handasa.example', false);
`;

const removal = (kind: string, id: string) => ({
  supplier_id: VERIFIED,
  kind: 'contact' as const,
  contact_kind: kind,
  contact_id: id,
  value: '',
});

async function statusOf(db: PGlite, id: string) {
  const { rows } = await db.query<{ status: string; is_primary: boolean }>(
    'select status, is_primary from public.supplier_contacts where id = $1',
    [id],
  );
  return rows[0];
}

describe('supplier contact removal', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(CHANGE_FIXTURE);
    await db.exec(CONTACTS);
  });
  after(async () => db.close());

  it('says a value already on another row is a duplicate, to be deleted instead', async () => {
    const result = await as(db, USERS.editor, async () => {
      const typed = { ...removal('phone', PHONE_A), value: '0545990250' };
      const own = { ...removal('phone', PHONE_B), value: '054-5990250' };
      return [await checkChange(db, typed), await checkChange(db, own)];
    });
    assert.deepEqual(
      result.map((r) => r.checks[0]?.problem),
      ['duplicate_contact', 'no_change'],
    );
  });

  it('checks a removal green, naming the detail, while another of its kind is left', async () => {
    const result = await as(db, USERS.editor, () => checkChange(db, removal('phone', PHONE_A)));
    assert.deepEqual(result, {
      outcome: 'green',
      checks: [{ check: 'contact_removal', outcome: 'green', name: '054-2244973' }],
    });
  });

  it('saves a green removal at once as an outdated contact, with its history', async () => {
    const saved = await as(db, USERS.editor, () => submitChange(db, removal('phone', PHONE_A)));
    assert.equal(saved.status, 'applied');
    assert.deepEqual(await statusOf(db, PHONE_A), { status: 'outdated', is_primary: false });
    const history = `select 1 from public.supplier_change_requests where contact_id = '${PHONE_A}'
      and old_value = '054-2244973' and new_value is null and status = 'applied'`;
    assert.equal(await count(db, history), 1);
  });

  it('refuses removing a detail that is already gone or belongs to someone else', async () => {
    await as(db, USERS.editor, async () => {
      assert.match(
        await failure(submitChange(db, removal('phone', PHONE_A))),
        /reason:change_blocked/,
      );
      const noId = { ...removal('phone', PHONE_B), contact_id: '' };
      assert.equal((await checkChange(db, noId)).outcome, 'red');
      assert.equal((await checkChange(db, removal('email', PHONE_B))).outcome, 'red');
    });
  });

  it('keeps removing the last phone waiting for another editor', async () => {
    const saved = await as(db, USERS.editor, () => submitChange(db, removal('phone', PHONE_B)));
    assert.equal(saved.status, 'pending');
    assert.equal((await statusOf(db, PHONE_B))?.status, 'current');
    const approve = (user: string) =>
      as(db, user, () => failure(decideChange(db, saved.request_id, { approve: true })));
    assert.match(await approve(USERS.editor), /reason:self_approval/);
    assert.equal(await approve(USERS.manager), 'no error');
    assert.equal((await statusOf(db, PHONE_B))?.status, 'outdated');
  });

  it('removes an address at once even when it is the only one', async () => {
    const saved = await as(db, USERS.editor, () => submitChange(db, removal('address', ADDRESS)));
    assert.equal(saved.status, 'applied');
    assert.equal((await statusOf(db, ADDRESS))?.status, 'outdated');
  });

  it('lets an admin remove the last email at once with a reason', async () => {
    await as(db, USERS.admin, async () => {
      assert.match(
        await failure(submitChange(db, removal('email', EMAIL))),
        /reason:change_reason_required/,
      );
      const saved = await submitChange(db, { ...removal('email', EMAIL), reason: 'כתובת ישנה' });
      assert.equal(saved.status, 'approved');
    });
    assert.equal((await statusOf(db, EMAIL))?.status, 'outdated');
  });

  it('keeps a removal out of the supplier personal area', async () => {
    const bad = `insert into public.supplier_change_requests (supplier_id, change_kind, new_value,
      checks, outcome, status) values ('${VERIFIED}', 'rename', null, '[]', 'green', 'applied')`;
    assert.match(await failure(db.exec(bad)), /supplier_change_requests_new_value_check/);
    const portal = `select private.portal_change_target('${JSON.stringify(removal('phone', PHONE_B))}')`;
    assert.match(await failure(db.exec(portal)), /Invalid supplier change/);
  });
});

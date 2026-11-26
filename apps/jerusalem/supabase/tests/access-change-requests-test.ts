import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { ACCESS_FIXTURE, USERS, UNIT_1, UNIT_2 } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

const REASON = 'עברתי לעבוד באגף אחר';

type Call = [args: string, params?: unknown[]];

async function ask(db: PGlite, who: string, [args, params = []]: Call) {
  return as(db, who, async () => {
    const row = await db.query<{ id: string }>(
      `select public.request_access_change(${args}) as id`,
      params,
    );
    return row.rows[0]?.id ?? '';
  });
}

type Decision = [id: string, approve: boolean, note?: string];

async function decide(db: PGlite, who: string, [id, approve, note]: Decision) {
  await as(db, who, async () => {
    await db.query('select public.decide_access_change($1,$2,$3)', [id, approve, note ?? null]);
  });
}

async function grants(db: PGlite, user: string) {
  const rows = await db.query<{ role: string; unit_id: string | null }>(
    `select role, unit_id from public.role_grants
     where user_id = $1 and revoked_at is null order by role`,
    [user],
  );
  return rows.rows;
}

describe('access change requests (screens-spec 4.1)', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('stops an active user from editing their own profile directly', async () => {
    await as(db, USERS.viewer, async () => {
      const result = await db.query(
        "update public.profiles set job_title = 'מנהלת' where user_id = $1",
        [USERS.viewer],
      );
      assert.equal(result.affectedRows, 0);
    });
    await as(db, USERS.pending, async () => {
      const result = await db.query(
        "update public.profiles set job_title = 'מהנדסת' where user_id = $1",
        [USERS.pending],
      );
      assert.equal(result.affectedRows, 1);
      await assert.rejects(
        db.query("update public.profiles set first_name = '1' where user_id = $1", [USERS.pending]),
        /invalid:too_short/,
      );
    });
  });

  it('asks only for oneself, only when active, and checks the content', async () => {
    for (const who of [USERS.pending, USERS.blocked]) {
      await assert.rejects(ask(db, who, [`'details', $1, null, null, null, $2`, [REASON, '{}']]));
    }
    await assert.rejects(
      ask(db, USERS.viewer, [`'details', 'אב', null, null, null, $1`, ['{"job_title":"מנהלת"}']]),
      /invalid:too_short/,
    );
    await assert.rejects(
      ask(db, USERS.viewer, [`'details', $1, null, null, null, $2`, [REASON, '{"email":"a@b.c"}']]),
      /invalid:bad_choice/,
    );
    await assert.rejects(
      ask(db, USERS.viewer, [`'details', $1, null, null, null, $2`, [REASON, '{"phone":"x"}']]),
      /invalid:bad_phone/,
    );
    const other = await db.query<{ id: string }>(
      'select id from public.role_grants where user_id = $1',
      [USERS.editor],
    );
    await assert.rejects(
      ask(db, USERS.viewer, [`'remove_role', $1, null, null, $2`, [REASON, other.rows[0]?.id]]),
      /invalid:bad_choice/,
    );
  });

  it('shows a request to its owner and to managers who may decide it, nobody else', async () => {
    const id = await ask(db, USERS.viewer, [
      `'details', $1, null, null, null, $2`,
      [REASON, '{"job_title":"מהנדסת בכירה","phone":"02-6297777"}'],
    ]);
    await assert.rejects(
      ask(db, USERS.viewer, [
        `'details', $1, null, null, null, $2`,
        [REASON, '{"last_name":"לוי"}'],
      ]),
      /duplicate key/,
    );
    for (const [who, sees] of [
      [USERS.viewer, 1],
      [USERS.admin, 1],
      [USERS.manager, 1],
      [USERS.editor, 0],
      [USERS.otherViewer, 0],
      [USERS.auditor, 0],
    ] as const) {
      await as(db, who, async () => {
        const rows = await db.query('select id from public.access_change_requests');
        assert.equal(rows.rows.length, sees, who);
      });
    }
    await as(db, USERS.manager, async () => {
      const overview = await db.query<{ counters: { users_pending: number } }>(
        'select public.admin_overview() as counters',
      );
      assert.equal(overview.rows[0]?.counters.users_pending, 2);
    });
    await assert.rejects(decide(db, USERS.viewer, [id, true]), /not authorized/);
    await assert.rejects(decide(db, USERS.editor, [id, true]), /not authorized/);
    await decide(db, USERS.manager, [id, true]);
    const profile = await db.query<{ job_title: string; phone: string }>(
      'select job_title, phone from public.profiles where user_id = $1',
      [USERS.viewer],
    );
    assert.deepEqual(profile.rows[0], { job_title: 'מהנדסת בכירה', phone: '02-6297777' });
    await assert.rejects(decide(db, USERS.admin, [id, true]), /not authorized/);
  });

  it('needs a reason to reject, and lets the owner cancel their own request', async () => {
    const id = await ask(db, USERS.viewer, [`'add_role', $1, 'editor', $2`, [REASON, UNIT_1]]);
    await assert.rejects(decide(db, USERS.manager, [id, false]), /invalid:required/);
    await decide(db, USERS.manager, [id, false, 'אין צורך כרגע']);
    const again = await ask(db, USERS.viewer, [`'add_role', $1, 'editor', $2`, [REASON, UNIT_1]]);
    await assert.rejects(
      as(db, USERS.editor, () => db.query('select public.cancel_access_change($1)', [again])),
    );
    await as(db, USERS.viewer, () => db.query('select public.cancel_access_change($1)', [again]));
    const rows = await db.query<{ status: string }>(
      'select status from public.access_change_requests where id = any($1) order by created_at',
      [[id, again]],
    );
    assert.deepEqual(
      rows.rows.map((r) => r.status),
      ['rejected', 'cancelled'],
    );
  });

  it('keeps managers to viewer and editor roles; an admin grants the rest', async () => {
    const id = await ask(db, USERS.editor, [
      `'add_role', $1, 'unit_manager', $2`,
      [REASON, UNIT_1],
    ]);
    await assert.rejects(decide(db, USERS.manager, [id, true]), /not authorized/);
    await decide(db, USERS.admin, [id, true]);
    assert.deepEqual(await grants(db, USERS.editor), [
      { role: 'editor', unit_id: UNIT_1 },
      { role: 'unit_manager', unit_id: UNIT_1 },
    ]);
    const own = await ask(db, USERS.manager, [`'add_role', $1, 'editor', $2`, [REASON, UNIT_1]]);
    await assert.rejects(decide(db, USERS.manager, [own, true]), /not authorized/);
  });

  it('moves a person with their viewer and editor roles in one step', async () => {
    const id = await ask(db, USERS.viewer, [`'move_unit', $1, null, $2`, [REASON, UNIT_2]]);
    await assert.rejects(decide(db, USERS.manager, [id, true]), /not authorized/);
    await decide(db, USERS.admin, [id, true]);
    const unit = await db.query<{ unit_id: string }>(
      'select unit_id from public.profiles where user_id = $1',
      [USERS.viewer],
    );
    assert.equal(unit.rows[0]?.unit_id, UNIT_2);
    assert.deepEqual(await grants(db, USERS.viewer), [{ role: 'viewer', unit_id: UNIT_2 }]);
  });

  it('applies a change an admin asks for at once, recorded as approved', async () => {
    const id = await ask(db, USERS.admin, [
      `'details', $1, null, null, null, $2`,
      [REASON, '{"job_title":"מנהל המערכת"}'],
    ]);
    const done = await db.query<{ status: string; decided_by: string; job_title: string }>(
      `select r.status, r.decided_by, p.job_title from public.access_change_requests r
       join public.profiles p using (user_id) where r.id = $1`,
      [id],
    );
    assert.deepEqual(done.rows[0], {
      status: 'approved',
      decided_by: USERS.admin,
      job_title: 'מנהל המערכת',
    });
  });

  it('keeps the last admin: removing it fails and nothing is recorded', async () => {
    const grant = await db.query<{ id: string }>(
      "select id from public.role_grants where user_id = $1 and role = 'admin'",
      [USERS.admin],
    );
    const call: Call = [`'remove_role', $1, null, null, $2`, [REASON, grant.rows[0]?.id]];
    await assert.rejects(ask(db, USERS.admin, call), /last_admin/);
    await db.query("insert into public.role_grants(user_id, role) values ($1, 'admin')", [
      USERS.auditor,
    ]);
    await ask(db, USERS.admin, call);
    assert.deepEqual(await grants(db, USERS.admin), []);
  });
});

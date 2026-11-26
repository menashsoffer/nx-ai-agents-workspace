import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, UNIT_1, UNIT_2, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

const REQUEST = '50000000-0000-0000-0000-000000000001';
const OTHER_UNIT_REQUEST = '50000000-0000-0000-0000-000000000002';
// Requests are stamped with the real creation time, so checks run on today's date.
const TODAY = new Date().toISOString().slice(0, 10);

interface Input {
  user_id: string;
  request: { estimated_value: number | string; requested_exemption: string | null };
  thresholds: { valid_from: string } | null;
  related: { estimated_value: number | string }[] | null;
}

async function inputFor(db: PGlite, user: string, target = REQUEST) {
  return inputOn(db, user, { target, on: TODAY });
}

async function inputOn(db: PGlite, user: string, at: { target: string; on: string }) {
  return as(db, user, async () => {
    const result = await db.query<{ input: Input }>(
      'select public.route_check_input($1, $2) as input',
      [at.target, at.on],
    );
    return result.rows[0]?.input;
  });
}

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('route check input', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
    await db.exec(`insert into public.engagement_requests
      (id, unit_id, subject, subject_key, estimated_value, value_includes_vat, status)
      values
      ('${REQUEST}', '${UNIT_1}', 'ניקיון', 'cleaning', 100000, false, 'draft'),
      ('${OTHER_UNIT_REQUEST}', '${UNIT_2}', 'ניקיון', 'cleaning', 1, false, 'draft'),
      (gen_random_uuid(), '${UNIT_1}', 'ניקיון ב', 'cleaning', 50000, true, 'submitted'),
      (gen_random_uuid(), '${UNIT_1}', 'ניקיון ג', 'cleaning', 70000, true, 'cancelled'),
      (gen_random_uuid(), '${UNIT_1}', 'הסעות', 'transport', 90000, true, 'draft')`);
  });
  after(async () => {
    await db.close();
  });

  it('gives an editor of the unit the request, its thresholds and related requests', async () => {
    const input = await inputFor(db, USERS.editor);
    assert.ok(input);
    assert.equal(input.user_id, USERS.editor);
    assert.equal(Number(input.request.estimated_value), 100000);
    const latest = await db.query<{ d: string }>(
      'select max(valid_from)::text as d from public.thresholds where valid_from <= $1',
      [TODAY],
    );
    assert.equal(input.thresholds?.valid_from, latest.rows[0]?.d);
    assert.deepEqual(
      input.related?.map((r) => Number(r.estimated_value)),
      [50000],
      'only open requests with the same subject key in the same unit',
    );
  });

  it('lets unit managers and admins check, but not viewers, auditors or other units', async () => {
    assert.ok(await inputFor(db, USERS.manager));
    assert.ok(await inputFor(db, USERS.admin));
    assert.equal(await errorCode(inputFor(db, USERS.viewer)), 'PT403');
    assert.equal(await errorCode(inputFor(db, USERS.auditor)), 'PT403');
    assert.equal(await errorCode(inputFor(db, USERS.blocked)), 'PT403');
    assert.equal(await errorCode(inputFor(db, USERS.editor, OTHER_UNIT_REQUEST)), 'PT403');
  });

  it('rejects anonymous callers and unknown requests', async () => {
    assert.equal(
      await errorCode(
        as(db, null, () =>
          db.query("select public.route_check_input($1, '2026-11-01')", [REQUEST]),
        ),
      ),
      '42501',
    );
    const unknown = '50000000-0000-0000-0000-0000000000ff';
    assert.equal(await errorCode(inputFor(db, USERS.editor, unknown)), 'PT404');
  });

  it('returns no thresholds before the first published row', async () => {
    const input = await inputOn(db, USERS.editor, { target: REQUEST, on: '2000-01-01' });
    assert.equal(input?.thresholds, null);
  });

  it('stops a user after 120 checks in an hour without affecting others', async () => {
    await db.exec(`update private.call_quota set calls = 120
      where user_id = '${USERS.manager}' and bucket = 'route_check'`);
    assert.equal(await errorCode(inputFor(db, USERS.manager)), 'PT429');
    assert.ok(await inputFor(db, USERS.editor));
    await db.exec(`update private.call_quota set window_start = now() - interval '61 minutes'
      where user_id = '${USERS.manager}'`);
    assert.ok(await inputFor(db, USERS.manager), 'a new window starts the count again');
  });

  it('keeps the results table closed to signed-in users and open to the service role', async () => {
    const write = `insert into public.route_checks (request_id, checked_on, input, route,
      status, allowed, engine_version) values ('${REQUEST}', current_date, '{}', 'r',
      'ok', true, 'test')`;
    assert.equal(await errorCode(as(db, USERS.admin, () => db.exec(write))), '42501');
    await db.exec('set role service_role');
    await db.exec(write);
    await db.exec('reset role');
    assert.equal(await count(db, 'select 1 from public.route_checks'), 1);
  });

  // The Edge Function inserts with `Prefer: return=representation` (insert ... returning),
  // which needs SELECT as well as INSERT. Without it every saved check failed with 42501.
  it('lets the service role read back the row it inserted', async () => {
    const write = `insert into public.route_checks (request_id, checked_on, input, route,
      status, allowed, engine_version) values ('${REQUEST}', current_date, '{}', 'r',
      'ok', true, 'test') returning id`;
    await db.exec('set role service_role');
    try {
      const result = await db.query<{ id: number }>(write);
      assert.equal(typeof result.rows[0]?.id, 'number');
    } finally {
      await db.exec('reset role');
    }
  });
});

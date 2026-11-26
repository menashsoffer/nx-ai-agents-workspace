import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, USERS } from './access-fixture.ts';
import { as, count, migratedDatabase } from './pglite.ts';

// The CBS October 2026 index on the 1985 base, as stored (4 decimals).
const OCTOBER_CPI = 1149.4864;
const NOVEMBER = '2026-11-16';

async function errorCode(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function asService<T>(db: PGlite, action: () => Promise<T>): Promise<T> {
  await db.exec('set role service_role');
  try {
    return await action();
  } finally {
    await db.exec('reset role');
  }
}

async function propose(db: PGlite, startsOn: string): Promise<string | undefined> {
  return asService(db, async () => {
    const result = await db.query<{ answer: string }>(
      'select public.propose_threshold($1, $2, $3) as answer',
      [OCTOBER_CPI, startsOn, 'CBS CPI 2026-10; test'],
    );
    return result.rows[0]?.answer;
  });
}

async function proposalId(db: PGlite, startsOn: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    'select id from public.threshold_proposals where valid_from = $1',
    [startsOn],
  );
  const id = result.rows[0]?.id;
  assert.ok(id);
  return id;
}

interface Choice {
  id: string;
  approve: boolean;
  note?: string;
}
function decide(db: PGlite, user: string | null, choice: Choice) {
  return as(db, user, () =>
    db.query('select public.decide_threshold_proposal($1, $2, $3)', [
      choice.id,
      choice.approve,
      choice.note ?? null,
    ]),
  );
}

describe('threshold proposals', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('proposes an uncovered month once and skips months already in force', async () => {
    assert.equal(await propose(db, '2026-10-16'), 'covered');
    assert.equal(await propose(db, NOVEMBER), 'proposed');
    assert.equal(await propose(db, NOVEMBER), 'pending');
    const row = await db.query<{ no_tender_max: string; zuta6_max: string }>(
      'select no_tender_max::text, zuta6_max::text from public.threshold_proposals',
    );
    const expected = await db.query<{ no_tender_max: string; zuta6_max: string }>(
      `select no_tender_max::numeric(14, 2)::text as no_tender_max,
        zuta6_max::numeric(14, 2)::text as zuta6_max from public.calculate_thresholds($1)`,
      [OCTOBER_CPI],
    );
    assert.deepEqual(row.rows, expected.rows, 'amounts come from the database formula');
  });

  it('lets only the service role propose and log runs', async () => {
    const call = "select public.propose_threshold(1000, '2026-12-16', 'x')";
    assert.equal(await errorCode(as(db, USERS.admin, () => db.query(call))), '42501');
    assert.equal(await errorCode(as(db, null, () => db.query(call))), '42501');
    const start = "select public.job_start('threshold-index', 30)";
    assert.equal(await errorCode(as(db, USERS.admin, () => db.query(start))), '42501');
  });

  it('shows proposals and runs to admins only', async () => {
    const read = (user: string) =>
      as(db, user, () => count(db, 'select 1 from public.threshold_proposals'));
    assert.equal(await read(USERS.admin), 1);
    assert.equal(await read(USERS.manager), 0);
    assert.equal(await read(USERS.auditor), 0);
  });

  it('refuses decisions from anyone but an admin', async () => {
    const id = await proposalId(db, NOVEMBER);
    assert.equal(await errorCode(decide(db, USERS.manager, { id, approve: true })), '42501');
    assert.equal(await errorCode(decide(db, USERS.auditor, { id, approve: true })), '42501');
    assert.equal(await errorCode(decide(db, null, { id, approve: true })), '42501');
  });

  it('adds the threshold row only when an admin approves', async () => {
    const id = await proposalId(db, NOVEMBER);
    const before = await count(db, 'select 1 from public.thresholds');
    await decide(db, USERS.admin, { id, approve: true });
    assert.equal(await count(db, 'select 1 from public.thresholds'), before + 1);
    const added = await db.query<{ valid_until: string; is_official: boolean }>(
      'select valid_until::text, is_official from public.thresholds where valid_from = $1',
      [NOVEMBER],
    );
    assert.deepEqual(added.rows, [{ valid_until: '2026-12-15', is_official: false }]);
    assert.equal(
      await errorCode(decide(db, USERS.admin, { id, approve: true })),
      'P0002',
      'decided once',
    );
    assert.equal(await propose(db, NOVEMBER), 'covered');
  });

  it('keeps a rejected month closed to new proposals', async () => {
    assert.equal(await propose(db, '2026-12-16'), 'proposed');
    const id = await proposalId(db, '2026-12-16');
    await assert.rejects(decide(db, USERS.admin, { id, approve: false }), /invalid:required/);
    await decide(db, USERS.admin, { id, approve: false, note: 'המדד תוקן אחרי הפרסום' });
    const kept = await db.query<{ decision_note: string }>(
      'select decision_note from public.threshold_proposals where id = $1',
      [id],
    );
    assert.equal(kept.rows[0]?.decision_note, 'המדד תוקן אחרי הפרסום');
    assert.equal(
      await count(db, "select 1 from public.thresholds where valid_from = '2026-12-16'"),
      0,
    );
    assert.equal(await propose(db, '2026-12-16'), 'decided');
  });

  it('skips a run that starts within the gap and records how a run ended', async () => {
    const start = () =>
      asService(db, async () => {
        const r = await db.query<{ id: number | null }>(
          "select public.job_start('threshold-index', 30) as id",
        );
        return r.rows[0]?.id ?? null;
      });
    const first = await start();
    assert.ok(first);
    assert.equal(await start(), null);
    await asService(db, () =>
      db.query('select public.job_finish($1, \'ok\', \'{"result":"covered"}\')', [first]),
    );
    const run = await db.query<{ status: string }>(
      'select status from public.job_runs where id = $1',
      [first],
    );
    assert.equal(run.rows[0]?.status, 'ok');
  });
});

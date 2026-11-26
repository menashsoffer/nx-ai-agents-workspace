// Usage analytics (usage-analytics-spec-he.md): who may report, what is kept, who may read.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { USERS } from './access-fixture.ts';
import { PEOPLE, SUPPLIER_ACCOUNT_FIXTURE } from './supplier-account-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

const VISIT = '70000000-0000-0000-0000-000000000001';
const DAY_MS = 86_400_000;
const isoDay = (offset: number) =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const start = { visit_id: VISIT, kind: 'visit_start', screen: 'catalog', device: 'desktop' };

function send(db: PGlite, events: unknown) {
  return db.query('select public.record_usage_events($1::jsonb)', [JSON.stringify(events)]);
}

async function rows(db: PGlite) {
  const result = await db.query<{ role: string; visitor_key: string; kind: string }>(
    'select role, visitor_key, kind from public.usage_events order by id',
  );
  return result.rows;
}

async function summary(db: PGlite, user: string, [from, to] = [isoDay(-1), isoDay(1)]) {
  return as(db, user, async () => {
    const result = await db.query<{ s: Record<string, unknown> }>(
      'select public.usage_summary($1, $2) as s',
      [from, to],
    );
    return result.rows[0]?.s ?? {};
  });
}

describe('usage events', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(SUPPLIER_ACCOUNT_FIXTURE);
  });
  after(async () => db.close());

  it('records the role from the server and no user id', async () => {
    const callers = [USERS.admin, USERS.viewer, USERS.auditor, PEOPLE.owner, PEOPLE.waiting];
    for (const user of callers) await as(db, user, () => send(db, [start]));
    const recorded = await rows(db);
    assert.deepEqual(
      recorded.map((r) => r.role),
      ['admin', 'viewer', 'auditor', 'supplier', 'other'],
    );
    for (const [i, user] of callers.entries()) {
      assert.match(recorded[i]?.visitor_key ?? '', /^[0-9a-f]{64}$/);
      assert.ok(!recorded[i]?.visitor_key.includes(user.replaceAll('-', '')));
    }
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'usage_events'",
    );
    assert.ok(!columns.rows.some((c) => /user|actor|email|url|text/.test(c.column_name)));
  });

  it('keeps one key per person per day, and a new one once the salt is gone', async () => {
    await db.exec('delete from public.usage_events');
    await as(db, USERS.editor, () => send(db, [start, { ...start, kind: 'visit_end' }]));
    await as(db, USERS.manager, () => send(db, [start]));
    await db.exec('delete from private.usage_salts');
    await as(db, USERS.editor, () => send(db, [start]));
    const [first, second, other, next] = (await rows(db)).map((r) => r.visitor_key);
    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.notEqual(first, next);
  });

  it('refuses anon and anonymous sign-ins', async () => {
    await as(db, null, () => assert.rejects(send(db, [start])));
    await db.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: USERS.viewer, role: 'authenticated', is_anonymous: true }),
    ]);
    await db.exec('set role authenticated');
    await assert.rejects(send(db, [start]));
    await db.exec('reset role');
  });

  it('rejects unknown fields, free text and malformed events, with nothing saved', async () => {
    const before = (await rows(db)).length;
    const bad = [
      [{ ...start, user_id: USERS.viewer }],
      [{ ...start, screen: '/supplier/123?q=name' }],
      [{ ...start, kind: 'delete_all' }],
      [{ ...start, action: 'save' }],
      [{ ...start, kind: 'action', action: 'Free text with spaces' }],
      [{ ...start, kind: 'step' }],
      [{ ...start, kind: 'step', step: 99 }],
      [{ ...start, duration_ms: 5 }],
      [{ ...start, device: 'tv' }],
      [start, 'not an object'],
      [],
      Array.from({ length: 51 }, () => start),
      { not: 'an array' },
    ];
    for (const events of bad) await as(db, USERS.viewer, () => assert.rejects(send(db, events)));
    assert.equal((await rows(db)).length, before);
  });

  it('closes the tables to direct reads and writes, even for the admin', async () => {
    for (const user of [USERS.admin, USERS.viewer, PEOPLE.owner])
      await as(db, user, async () => {
        await assert.rejects(db.query('select * from public.usage_events'));
        await assert.rejects(db.query('select * from public.usage_daily'));
        await assert.rejects(
          db.query(
            'insert into public.usage_daily (day, role, kind, screen, events, visitors, visits)' +
              " values (current_date, 'admin', 'action', 'x', 1, 1, 1)",
          ),
        );
      });
  });

  it('shows the summary to the admin only', async () => {
    for (const user of [USERS.auditor, USERS.viewer, USERS.manager, PEOPLE.owner])
      await assert.rejects(summary(db, user));
    await assert.rejects(summary(db, USERS.admin, ['2026-02-01', '2026-01-01']));
    await assert.rejects(summary(db, USERS.admin, ['2020-01-01', '2026-01-01']));
  });

  it('sums visits, screens, exits, actions and wizard steps', async () => {
    await db.exec('delete from public.usage_events');
    const visit = { visit_id: VISIT, device: 'mobile' };
    await as(db, USERS.viewer, () =>
      send(db, [
        { ...visit, kind: 'visit_start', screen: 'catalog' },
        { ...visit, kind: 'screen_view', screen: 'catalog', duration_ms: 4000 },
        { ...visit, kind: 'action', screen: 'catalog', action: 'search' },
        { ...visit, kind: 'action', screen: 'catalog', action: 'search' },
        { ...visit, kind: 'step', screen: 'engagement', step: 2 },
        { ...visit, kind: 'screen_view', screen: 'engagement', duration_ms: 1000 },
        { ...visit, kind: 'visit_end', screen: 'engagement', duration_ms: 5000 },
      ]),
    );
    const s = await summary(db, USERS.admin, ['2000-01-01', '2000-12-31']);
    assert.deepEqual(s.days, []);
    const today = await summary(db, USERS.admin, [isoDay(-2), isoDay(2)]);
    const days = today.days as Record<string, unknown>[];
    assert.deepEqual(
      days.map((d) => [d.role, d.visitors, d.visits]),
      [['viewer', 1, 1]],
    );
    assert.deepEqual(today.actions, [{ screen: 'catalog', action: 'search', count: 2 }]);
    assert.deepEqual(today.steps, [{ screen: 'engagement', step: 2, visits: 1 }]);
    const screens = today.screens as Record<string, unknown>[];
    assert.deepEqual(
      screens.find((x) => x.screen === 'engagement'),
      {
        screen: 'engagement',
        views: 1,
        exits: 1,
        total_ms: 1000,
      },
    );
    assert.equal(today.visit_ms, 5000);
    assert.equal(today.ended_visits, 1);
  });

  it('rolls days past 90 into daily sums that the summary still counts', async () => {
    await db.exec(`
      delete from public.usage_events;
      insert into public.usage_events
        (visit_id, visitor_key, role, kind, screen, action, device, created_at)
      values ('${VISIT}', repeat('a', 64), 'editor', 'action', 'catalog', 'export', 'desktop',
        now() - interval '200 days'),
        ('${VISIT}', repeat('a', 64), 'editor', 'action', 'catalog', 'export', 'desktop',
        now() - interval '200 days' + interval '1 minute');
    `);
    await as(db, USERS.viewer, () => send(db, [start]));
    const left = await db.query(
      "select 1 from public.usage_events where created_at < now() - interval '100 days'",
    );
    assert.equal(left.rows.length, 0);
    const daily = await db.query<{ events: number; visitors: number }>(
      'select events, visitors from public.usage_daily',
    );
    assert.deepEqual(daily.rows, [{ events: 2, visitors: 1 }]);
    const s = await summary(db, USERS.admin, [isoDay(-210), isoDay(-190)]);
    assert.deepEqual(s.actions, [{ screen: 'catalog', action: 'export', count: 2 }]);
  });
});

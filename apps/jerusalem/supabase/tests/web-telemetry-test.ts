import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { ACCESS_FIXTURE, USERS } from './access-fixture.ts';
import { VITAL_BUDGETS } from '../../web/src/lib/vitals-model.ts';
import { as, migratedDatabase } from './pglite.ts';
describe('anonymous web monitoring', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });
  const send = (events: unknown) =>
    db.query('select public.record_web_telemetry($1::jsonb)', [JSON.stringify(events)]);
  it('accepts batches from each active member, without recording its identity', async () => {
    for (const user of [USERS.viewer, USERS.editor, USERS.manager, USERS.admin, USERS.auditor])
      await as(db, user, async () => {
        await send([{ name: 'LCP', value: 1500, bounded: false }]);
      });
    const result = await db.query<{ name: string; within_budget: boolean }>(
      'select name,within_budget from public.web_telemetry',
    );
    assert.equal(result.rows.length, 5);
    assert.ok(result.rows.every((row) => row.within_budget));
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name='web_telemetry'",
    );
    assert.ok(
      !columns.rows.some((c) => /actor|user|session|url|message|stack/.test(c.column_name)),
    );
  });
  it('refuses anonymous, pending and blocked reports', async () => {
    for (const user of [null, USERS.pending, USERS.blocked])
      await as(db, user, async () => {
        await assert.rejects(send([{ name: 'CLS', value: 0 }]));
      });
  });
  it('allows only admin and auditor to read, and no direct authenticated writes', async () => {
    for (const user of [USERS.viewer, USERS.editor, USERS.manager, USERS.pending, USERS.blocked])
      await as(db, user, async () => {
        const result = await db.query('select * from public.web_telemetry');
        assert.equal(result.rows.length, 0);
        await assert.rejects(
          db.query("insert into public.web_telemetry(name,value) values('CLS',0)"),
        );
      });
    for (const user of [USERS.admin, USERS.auditor])
      await as(db, user, async () => {
        assert.ok((await db.query('select * from public.web_telemetry')).rows.length > 0);
      });
  });
  it('rejects identifying fields, arbitrary errors, malformed values and oversized batches atomically', async () => {
    await as(db, USERS.admin, async () => {
      for (const item of [
        { name: 'LCP', value: 1, user_id: USERS.admin },
        { name: 'error', error_code: 'secret@example.test', boundary: 'route' },
        { name: 'error', error_code: 'unexpected', boundary: '/supplier/private' },
        { name: 'CLS' },
        { name: 'CLS', value: -1 },
        { name: 'LCP', value: '5' },
        { name: 'INP', value: Infinity },
        { name: 'CLS', value: 0, bounded: null },
      ])
        await assert.rejects(send([item]));
      await assert.rejects(send([]));
      await assert.rejects(send(Array.from({ length: 51 }, () => ({ name: 'CLS', value: 0 }))));
      await assert.rejects(
        send([
          { name: 'CLS', value: 0 },
          { name: 'error', message: 'private' },
        ]),
      );
    });
    assert.equal((await db.query('select * from public.web_telemetry')).rows.length, 5);
  });
  it('compares measurements to the project budgets at and just above every boundary', async () => {
    await as(db, USERS.admin, async () => {
      const values = Object.entries(VITAL_BUDGETS).flatMap(([name, value]) => [
        { name, value },
        { name, value: value + (name === 'CLS' ? 0.0001 : 1) },
      ]);
      await send([...values, { name: 'error', error_code: 'unexpected', boundary: 'root' }]);
    });
    const result = await db.query<{ within_budget: boolean | null }>(
      'select within_budget from public.web_telemetry order by id desc limit 7',
    );
    assert.deepEqual(
      result.rows.map((r) => r.within_budget),
      [null, false, true, false, true, false, true],
    );
  });
  it('does not invalidate the catalog cache when recording measurements', async () => {
    await as(db, USERS.viewer, async () => {
      const first = await db.query<{ version: string }>(
        "select public.catalog_snapshot(null)->>'version' as version",
      );
      await send([{ name: 'CLS', value: 0 }]);
      const next = await db.query<{ unchanged: boolean }>(
        "select (public.catalog_snapshot($1)->>'unchanged')::boolean as unchanged",
        [first.rows[0]?.version],
      );
      assert.equal(next.rows[0]?.unchanged, true);
    });
  });
  it('limits reporting per caller', async () => {
    await db.query(
      "update private.call_quota set calls=120 where user_id=$1 and bucket='web_telemetry'",
      [USERS.admin],
    );
    await as(db, USERS.admin, async () => {
      await assert.rejects(send([{ name: 'CLS', value: 0 }]), /too many reports/i);
    });
  });
  it('counts shown errors by kind and screen, with fixed values only', async () => {
    await as(db, USERS.editor, async () => {
      await send([
        {
          name: 'error',
          error_code: 'http_5xx',
          boundary: 'action',
          kind: 'system',
          screen: 'engagement',
        },
        {
          name: 'error',
          error_code: 'http_5xx',
          boundary: 'action',
          kind: 'system',
          screen: 'engagement',
        },
        {
          name: 'error',
          error_code: 'unexpected',
          boundary: 'route',
          kind: 'offline',
          screen: 'catalog',
        },
      ]);
      for (const item of [
        {
          name: 'error',
          error_code: 'unexpected',
          boundary: 'action',
          kind: 'oops',
          screen: 'catalog',
        },
        {
          name: 'error',
          error_code: 'unexpected',
          boundary: 'action',
          kind: 'system',
          screen: '/supplier/1',
        },
        { name: 'CLS', value: 0, kind: 'system' },
      ])
        await assert.rejects(send([item]));
    });
  });

  it('shows the 7-day error summary to administrators only', async () => {
    for (const user of [USERS.viewer, USERS.editor, USERS.manager, USERS.auditor])
      await as(db, user, async () => {
        await assert.rejects(db.query('select * from public.error_summary()'), { code: '42501' });
      });
    await as(db, USERS.admin, async () => {
      const rows = await db.query<{ kind: string; screen: string; failures: number }>(
        'select kind, screen, failures::int as failures from public.error_summary()',
      );
      assert.deepEqual(rows.rows[0], { kind: 'system', screen: 'engagement', failures: 2 });
      assert.ok(rows.rows.some((r) => r.kind === 'offline' && r.screen === 'catalog'));
    });
  });
});

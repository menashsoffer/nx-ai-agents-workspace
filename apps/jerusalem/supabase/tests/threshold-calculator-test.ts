import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { thresholdsFromIndex } from '../functions/_shared/procurement/index.ts';
import { ACCESS_FIXTURE, USERS } from './access-fixture.ts';
import { as, migratedDatabase } from './pglite.ts';

interface Amounts {
  no_tender_max: string;
  zuta4_max: string;
  zuta6_max: string;
}

describe('threshold calculator', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
    await db.exec(ACCESS_FIXTURE);
  });
  after(async () => {
    await db.close();
  });

  it('gives the amounts in the regulations for the base index', async () => {
    const result = await db.query<Amounts>('select * from public.calculate_thresholds(175.3)');
    assert.deepEqual(result.rows[0], {
      no_tender_max: '26000',
      zuta4_max: '63500',
      zuta6_max: '127000',
    });
  });

  it('matches the TypeScript engine across a range of indexes', async () => {
    for (let index = 900; index <= 1400; index += 0.7) {
      const value = Number(index.toFixed(1));
      const expected = thresholdsFromIndex(value, '2026-11-16', 'test');
      const result = await db.query<Amounts>(
        `select * from public.calculate_thresholds(${String(value)})`,
      );
      const row = result.rows[0];
      assert.equal(Number(row?.no_tender_max), expected.noTenderMax, `index ${String(value)}`);
      assert.equal(Number(row?.zuta4_max), expected.zuta4Max, `index ${String(value)}`);
      assert.equal(Number(row?.zuta6_max), expected.zuta6Max, `index ${String(value)}`);
    }
  });

  it('reproduces every stored CBS row from its index', async () => {
    const result = await db.query<{ valid_from: string }>(
      `select t.valid_from::text from public.thresholds t
        cross join lateral public.calculate_thresholds(t.index_value) c
        where t.index_value is not null
          and (c.no_tender_max, c.zuta4_max, c.zuta6_max)
            is distinct from (t.no_tender_max, t.zuta4_max, t.zuta6_max)`,
    );
    assert.deepEqual(result.rows, []);
  });

  it('rounds an exact half to the even hundred', async () => {
    const result = await db.query<{ a: string; b: string }>(
      `select private.indexed_amount(150, 1) as a, private.indexed_amount(250, 1) as b`,
    );
    assert.deepEqual(result.rows[0], { a: '200', b: '200' });
  });

  it('lets only an admin record a month, on an update day, once', async () => {
    const record = (day: string) =>
      `select public.record_threshold(1150.0, '${day}', 'מדד אוקטובר 2026')`;
    await as(db, USERS.manager, async () => {
      await assert.rejects(db.query(record('2026-11-16')), /Not authorized/);
    });
    await as(db, USERS.auditor, async () => {
      await assert.rejects(db.query(record('2026-11-16')), /Not authorized/);
    });
    await as(db, USERS.admin, async () => {
      await assert.rejects(db.query(record('2026-11-17')), /reason:threshold_start_day/);
      await db.query(record('2026-11-16'));
      await assert.rejects(db.query(record('2026-11-16')));
      const stored = await db.query<{ valid_until: string; is_official: boolean }>(
        `select valid_until::text, is_official from public.thresholds
          where valid_from = '2026-11-16'`,
      );
      assert.deepEqual(stored.rows[0], { valid_until: '2026-12-15', is_official: false });
    });
  });

  it('reports how far the stored thresholds reach', async () => {
    await as(db, USERS.viewer, async () => {
      const result = await db.query<{ covered_until: string }>(
        'select covered_until::text from public.threshold_coverage',
      );
      assert.equal(result.rows[0]?.covered_until, '2026-12-15');
    });
  });
});

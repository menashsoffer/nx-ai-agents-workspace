import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { thresholdValidUntil } from '../functions/_shared/procurement/amounts.ts';
import { thresholdsFromCbs } from '../functions/_shared/procurement/cbs.ts';
import { migratedDatabase } from './pglite.ts';

interface Observation {
  year: number;
  month: number;
  index: number;
}

interface ThresholdRow {
  valid_from: string;
  valid_until: string;
  no_tender_max: string;
  zuta4_max: string;
  zuta6_max: string;
  index_value: string;
  source: string;
  is_official: boolean;
}

describe('threshold history against CBS snapshot', () => {
  let db: PGlite;
  before(async () => {
    db = await migratedDatabase();
  });
  after(async () => {
    await db.close();
  });

  it('reproduces each source observation and its period', async () => {
    const path = new URL('./cbs-history.json', import.meta.url);
    const snapshot = JSON.parse(await readFile(path, 'utf8')) as { observations: Observation[] };
    const result = await db.query<ThresholdRow>(`
      select valid_from::text, valid_until::text, no_tender_max::text,
        zuta4_max::text, zuta6_max::text, index_value::text, source, is_official
      from public.thresholds order by valid_from`);
    assert.equal(result.rows.length, snapshot.observations.length);
    for (const [i, observation] of snapshot.observations.entries()) {
      const row = result.rows[i];
      assert.ok(row);
      const expected = thresholdsFromCbs(observation.index, observation.year, observation.month);
      assert.equal(row.valid_from, expected.effectiveFrom);
      assert.equal(row.valid_until, thresholdValidUntil(expected));
      assert.equal(Number(row.no_tender_max), expected.noTenderMax);
      assert.equal(Number(row.zuta4_max), expected.zuta4Max);
      assert.equal(Number(row.zuta6_max), expected.zuta6Max);
      assert.equal(Number(row.index_value), Number(observation.index.toFixed(4)));
      assert.equal(row.source, expected.source);
      assert.equal(row.is_official, false);
    }
  });
});

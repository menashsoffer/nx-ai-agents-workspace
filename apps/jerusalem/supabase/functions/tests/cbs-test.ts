import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cbsIndex, thresholdInsert, thresholdsFromCbs } from '../_shared/procurement/cbs.ts';

describe('CBS threshold calculation', () => {
  it('calculates the published September 2026 observation and the following period', () => {
    const result = thresholdsFromCbs(1150.5790803726, 2026, 9);
    assert.equal(result.effectiveFrom, '2026-10-16');
    assert.equal(result.noTenderMax, 170700);
    assert.equal(result.zuta4Max, 416800);
    assert.equal(result.zuta6Max, 833600);
    assert.equal(result.isOfficial, false);
    assert.match(result.source, /2026-09/);
  });

  it('handles year boundaries and rejects invalid inputs', () => {
    assert.equal(thresholdsFromCbs(1000, 2025, 12).effectiveFrom, '2026-01-16');
    assert.throws(() => thresholdsFromCbs(NaN, 2026, 9));
    assert.throws(() => thresholdsFromCbs(1000, 2026, 13));
    assert.throws(() => thresholdsFromCbs(1000, 2026.5, 9));
  });
});

describe('CBS response validation', () => {
  const observation = {
    year: 2026,
    month: 9,
    prevBase: [{ baseDesc: '1985 ממוצע', value: 1150.5790803726 }],
  };
  const response = { month: [{ code: 120010, date: [observation] }] };

  it('uses the requested observation and the correct base', () => {
    assert.equal(cbsIndex(response, 2026, 9), 1150.5790803726);
    assert.throws(() => cbsIndex(response, 2026, 10), /missing or ambiguous/);
  });

  it('rejects duplicate observations, missing bases, and malformed responses', () => {
    const duplicate = { month: [{ code: 120010, date: [observation, observation] }] };
    assert.throws(() => cbsIndex(duplicate, 2026, 9), /missing or ambiguous/);
    const noBase = { month: [{ code: 120010, date: [{ ...observation, prevBase: [] }] }] };
    assert.throws(() => cbsIndex(noBase, 2026, 9), /1985-base/);
    assert.throws(() => cbsIndex({ month: null }, 2026, 10), /not yet published/);
    assert.throws(() => cbsIndex(null, 2026, 9), /Unexpected/);
  });
});

describe('reviewable SQL generation', () => {
  it('includes the calculated amounts, period, source and unverified status', () => {
    const sql = thresholdInsert(1150.5790803726, 2026, 9);
    assert.match(sql, /2026-10-16.*2026-11-15.*170700.*416800.*833600/s);
    assert.match(sql, /CBS CPI 2026-09/);
    assert.match(sql, /false\);$/);
  });

  it('rejects indices that cannot be represented without changing a threshold', () => {
    assert.throws(() => thresholdInsert(1_000_000, 2026, 9), /precision/);
    assert.throws(() => thresholdInsert(0, 2026, 9), /Invalid/);
  });
});

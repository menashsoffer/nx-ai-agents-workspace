import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkContinuation320,
  checkIncrease,
  checkNewContract,
  checkSplitting,
  comparableValue,
  indexedAmount,
  nextUpdateDay,
  thresholdsFor,
  thresholdsFromIndex,
  thresholdValidUntil,
  type ContinuationRequest,
  type NewContractRequest,
  type Thresholds,
} from '../_shared/procurement/index.ts';

const OCT_2021: Thresholds = {
  effectiveFrom: '2021-10-16',
  noTenderMax: 145_500,
  zuta4Max: 355_300,
  zuta6Max: 710_600,
  source: 'תקנות',
  isOfficial: true,
};
const NOV_2026: Thresholds = {
  effectiveFrom: '2026-10-16',
  noTenderMax: 170_700,
  zuta4Max: 416_800,
  zuta6Max: 833_600,
  source: 'חישוב',
  isOfficial: false,
};
const TABLE = [OCT_2021, NOV_2026];
const DAY = '2026-11-12';

function route(value: number, extra: Partial<NewContractRequest> = {}) {
  return checkNewContract({ value, on: DAY, valueIncludesVat: true, ...extra }, TABLE);
}

describe('thresholds', () => {
  it('rounds to the nearest 100', () => {
    assert.equal(indexedAmount(26_000, 1), 26_000);
    assert.equal(indexedAmount(26_000, 5.596), 145_500);
  });

  it('reproduces the October 2021 amounts from the index', () => {
    const t = thresholdsFromIndex((175.3 * 710_600) / 127_000, '2021-10-16', 'test');
    assert.deepEqual([t.noTenderMax, t.zuta4Max, t.zuta6Max], [145_500, 355_300, 710_600]);
  });

  it('picks the latest table in force', () => {
    assert.equal(thresholdsFor(DAY, TABLE), NOV_2026);
    assert.equal(thresholdsFor('2026-10-15', TABLE), OCT_2021);
    assert.throws(() => thresholdsFor('2020-01-01', TABLE));
  });

  it('converts VAT both ways', () => {
    assert.ok(Math.abs(comparableValue(100, { valueIncludesVat: false }) - 118) < 1e-9);
    assert.equal(comparableValue(100, { valueIncludesVat: true }), 100);
    const net = comparableValue(118, { valueIncludesVat: true, compareInclVat: false });
    assert.ok(Math.abs(net - 100) < 1e-9);
  });

  it('expires on the day before the next update day', () => {
    const explicit = { ...NOV_2026, isOfficial: true, validUntil: '2027-01-01' };
    assert.equal(thresholdValidUntil(explicit), '2027-01-01');
    assert.equal(thresholdValidUntil(NOV_2026), '2026-11-15');
    assert.equal(nextUpdateDay('2026-12-20'), '2027-01-16');
    assert.equal(nextUpdateDay('2026-11-03'), '2026-11-16');
  });
});

describe('new contract', () => {
  it('routes by value at the exact boundaries', () => {
    assert.equal(route(170_700).route, 'no_tender_low_value');
    assert.equal(route(170_700.01).route, 'zuta_4');
    assert.equal(route(416_800).route, 'zuta_4');
    assert.equal(route(500_000).route, 'zuta_6');
    assert.equal(route(833_600).route, 'zuta_6');
    assert.equal(route(900_000).route, 'public_tender');
  });

  it('lets VAT move the route', () => {
    const base = { value: 150_000, on: DAY, valueIncludesVat: false };
    assert.equal(checkNewContract(base, TABLE).route, 'zuta_4');
    assert.equal(
      checkNewContract({ ...base, compareInclVat: false }, TABLE).route,
      'no_tender_low_value',
    );
  });

  it('needs review once the thresholds are stale', () => {
    assert.equal(route(1000).allowed, true);
    const late = { value: 1000, valueIncludesVat: true, relatedValues: [] };
    assert.equal(checkNewContract({ ...late, on: '2026-11-16' }, TABLE).status, 'needs_review');
    assert.equal(checkNewContract({ ...late, on: '2022-01-01' }, TABLE).status, 'needs_review');
  });

  it('wires the splitting check into the result', () => {
    const split = route(100_000, { relatedValues: [100_000] });
    assert.equal(split.splittingChecked, true);
    assert.equal(split.route, 'no_tender_low_value');
    assert.equal(split.status, 'needs_review');
    assert.ok(split.warnings.some((w) => w.includes('פיצול')));
    const unchecked = route(100_000);
    assert.equal(unchecked.splittingChecked, false);
    assert.ok(unchecked.warnings.some((w) => w.includes('לא בוצעה')));
    assert.equal(route(10_000, { relatedValues: [10_000] }).allowed, true);
  });

  it('warns about unofficial thresholds only', () => {
    assert.ok(route(1000).warnings.some((w) => w.includes('אינם פרסום רשמי')));
    const old = checkNewContract({ value: 1000, on: '2022-01-01', valueIncludesVat: true }, TABLE);
    assert.ok(!old.warnings.some((w) => w.includes('אינם פרסום רשמי')));
  });

  it('applies 3(8) only with the required fact', () => {
    const applied = route(900_000, { exemption: '3(8)', facts: { professional_work: true } });
    assert.equal(applied.route, 'exemption_3_8');
    assert.ok(applied.approver.includes('ועדת הפטור'));
    assert.ok(applied.requirements.some((r) => r.includes('8/2016')));
    const fallback = route(900_000, { exemption: '3(8)' });
    assert.equal(fallback.route, 'public_tender');
    assert.equal(fallback.missing.length, 1);
  });

  it('keeps 3(14) at needs_review even with every modeled fact', () => {
    const facts = { counterparty_is_npo: true, city_holding_40: true };
    const all = { ...facts, purpose_education_culture_welfare_sport: true };
    const d = route(900_000, { exemption: '3(14)', facts: all });
    assert.equal(d.route, 'exemption_3_14');
    assert.equal(d.status, 'needs_review');
    assert.equal(d.allowed, false);
    assert.ok(d.missing.length > 0);
    const partial = route(900_000, { exemption: '3(14)', facts });
    assert.equal(partial.route, 'public_tender');
    assert.equal(partial.missing.length, 1);
  });

  it('flags an unknown exemption', () => {
    const d = route(900_000, { exemption: '3(99)' });
    assert.equal(d.route, 'public_tender');
    assert.ok(d.warnings.length > 0);
  });

  it('rejects values that are not finite and non-negative', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      assert.throws(() => route(bad), Error);
    }
    assert.throws(() => route(1, { relatedValues: [Number.NaN] }), Error);
    assert.equal(route(0).allowed, true);
  });

  it('rejects malformed dates', () => {
    const bad = { value: 1, valueIncludesVat: true };
    assert.throws(() => checkNewContract({ ...bad, on: '2026-02-30' }, TABLE), Error);
    assert.throws(() => checkNewContract({ ...bad, on: '12.11.2026' }, TABLE), Error);
  });
});

describe('contract increase', () => {
  it('caps existing items at 50% cumulatively', () => {
    const base = { kind: 'existing_item', baseAmount: 100, previousIncreases: 0 } as const;
    assert.equal(checkIncrease({ ...base, newIncrease: 50 }).allowed, true);
    assert.equal(checkIncrease({ ...base, previousIncreases: 30, newIncrease: 30 }).allowed, false);
  });

  it('caps added items at 25%, or 50% after a council decision', () => {
    const base = {
      kind: 'added_items',
      baseAmount: 100,
      previousIncreases: 0,
      newIncrease: 30,
    } as const;
    assert.equal(checkIncrease(base).allowed, false);
    const council = checkIncrease({ ...base, councilDecidedTenderUseless: true });
    assert.equal(council.allowed, true);
    assert.ok(council.requirements.some((r) => r.includes('מועצה')));
  });

  it('warns near the cap and reports the percentage', () => {
    const d = checkIncrease({
      kind: 'added_items',
      baseAmount: 100,
      previousIncreases: 0,
      newIncrease: 22,
    });
    assert.equal(d.allowed, true);
    assert.ok(d.warnings.length > 0);
    assert.equal(d.increasePercent, 22);
  });

  it('rejects invalid amounts', () => {
    const base = {
      kind: 'existing_item',
      baseAmount: 100,
      previousIncreases: 0,
      newIncrease: 1,
    } as const;
    assert.throws(() => checkIncrease({ ...base, baseAmount: 0 }), Error);
    assert.throws(() => checkIncrease({ ...base, previousIncreases: -1 }), Error);
    assert.throws(() => checkIncrease({ ...base, newIncrease: -500 }), Error);
    assert.throws(() => checkIncrease({ ...base, newIncrease: Number.NaN }), Error);
  });
});

describe('continuation under 3(20)', () => {
  const base: ContinuationRequest = {
    on: DAY,
    first: { value: 100_000, months: 12 },
    previous: [],
    next: { value: 50_000, months: 3 },
    committeeConvinced: true,
    specialStateActiveConfirmed: true,
  };

  it('allows a continuation within the limits', () => {
    assert.equal(checkContinuation320(base).allowed, true);
  });

  it('blocks before the provision starts', () => {
    assert.equal(checkContinuation320({ ...base, on: '2026-04-20' }).allowed, false);
  });

  it('counts months and value cumulatively', () => {
    assert.equal(
      checkContinuation320({ ...base, previous: [{ value: 10_000, months: 4 }] }).allowed,
      false,
    );
    assert.equal(
      checkContinuation320({ ...base, previous: [{ value: 60_000, months: 1 }] }).allowed,
      false,
    );
  });

  it('blocks once the provision expired', () => {
    const d = checkContinuation320({ ...base, specialStateEnd: '2026-10-01' });
    assert.equal(d.status, 'blocked');
  });

  it('is undecided when validity is unknown', () => {
    const { specialStateActiveConfirmed: _ignored, ...unknown } = base;
    const d = checkContinuation320(unknown);
    assert.equal(d.status, 'needs_review');
    assert.equal(d.allowed, false);
    assert.ok(d.missing.length > 0);
  });

  it('never downgrades blocked to needs_review', () => {
    const { specialStateActiveConfirmed: _ignored, ...unknown } = base;
    const d = checkContinuation320({ ...unknown, previous: [{ value: 10_000, months: 4 }] });
    assert.equal(d.status, 'blocked');
  });
});

describe('splitting', () => {
  it('detects a split that changes the route', () => {
    assert.notEqual(checkSplitting(100_000, [100_000], NOV_2026), null);
  });

  it('ignores related requests that keep the route', () => {
    assert.equal(checkSplitting(10_000, [10_000], NOV_2026), null);
    assert.equal(checkSplitting(10_000, [], NOV_2026), null);
  });
});

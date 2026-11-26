// Edge cases of the money and threshold helpers: boundaries, rounding and bad input.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  comparableValue,
  indexedAmount,
  requireAmount,
  thresholdsFor,
  thresholdsFromIndex,
  thresholdValidUntil,
  type Thresholds,
} from '../_shared/procurement/amounts.ts';

const BASE: Thresholds = {
  effectiveFrom: '2026-01-16',
  noTenderMax: 1,
  zuta4Max: 2,
  zuta6Max: 3,
  source: 'test',
  isOfficial: false,
};

describe('requireAmount', () => {
  it('accepts numbers and numeric text, including zero', () => {
    assert.equal(requireAmount(0, 'x'), 0);
    assert.equal(requireAmount(' 12.5 ', 'x'), 12.5);
    assert.equal(requireAmount(0.01, 'x', true), 0.01);
  });

  it('rejects text that is not a number, empty text and non-finite values', () => {
    for (const value of ['abc', '', '   ', null, undefined, Number.NaN, Infinity, {}]) {
      assert.throws(() => requireAmount(value, 'value'), /value must be a finite number/);
    }
  });

  it('rejects a negative amount, and zero where a positive amount is required', () => {
    assert.throws(() => requireAmount(-0.01, 'value'), /must be zero or more/);
    assert.throws(() => requireAmount(0, 'value', true), /must be positive/);
    assert.throws(() => requireAmount('-1', 'value', true), /must be positive/);
  });
});

describe('indexed amounts', () => {
  it('rounds to the nearest hundred, half to even', () => {
    assert.equal(indexedAmount(100, 1.005), 100);
    assert.equal(indexedAmount(100, 1.015), 100);
    assert.equal(indexedAmount(1000, 1.005), 1000);
    assert.equal(indexedAmount(1050, 1), 1000);
    assert.equal(indexedAmount(1150, 1), 1200);
    assert.equal(indexedAmount(1149, 1), 1100);
  });

  it('builds unofficial thresholds from an index on the 1985 base', () => {
    const t = thresholdsFromIndex(175.3, '2026-02-16', 'CBS');
    assert.deepEqual(t, {
      effectiveFrom: '2026-02-16',
      noTenderMax: 26_000,
      zuta4Max: 63_500,
      zuta6Max: 127_000,
      source: 'CBS',
      isOfficial: false,
    });
  });
});

describe('threshold periods', () => {
  it('ends a period the day before the next update day unless it says otherwise', () => {
    assert.equal(thresholdValidUntil(BASE), '2026-02-15');
    assert.equal(thresholdValidUntil({ ...BASE, validUntil: '2026-01-20' }), '2026-01-20');
  });

  it('picks the latest period that started on or before the day', () => {
    const later = { ...BASE, effectiveFrom: '2026-02-16' };
    assert.equal(thresholdsFor('2026-02-15', [later, BASE]), BASE);
    assert.equal(thresholdsFor('2026-02-16', [BASE, later]), later);
    assert.throws(() => thresholdsFor('2026-01-15', [BASE]), /No thresholds in force/);
  });
});

describe('comparableValue', () => {
  it('adds or removes VAT at a given rate', () => {
    assert.equal(comparableValue(100, { valueIncludesVat: false, vatRate: 0.5 }), 150);
    assert.equal(
      comparableValue(150, { valueIncludesVat: true, compareInclVat: false, vatRate: 0.5 }),
      100,
    );
    assert.equal(comparableValue(100, { valueIncludesVat: false, compareInclVat: false }), 100);
  });
});

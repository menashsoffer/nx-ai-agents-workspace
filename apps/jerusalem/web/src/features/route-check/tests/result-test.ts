import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNewContract,
  parseIsoDate,
} from '../../../../../supabase/functions/_shared/procurement/index.ts';
import { resultSchema, checkInputSchema, routeLabel } from '../model/result.ts';
const on = parseIsoDate('2026-11-16');
const threshold = {
  effectiveFrom: on,
  validUntil: on,
  noTenderMax: 100,
  zuta4Max: 200,
  zuta6Max: 300,
  source: 'פרסום רשמי',
  isOfficial: true,
};
const result = (value: number) => ({
  id: 1,
  ...checkNewContract(
    { value, on, valueIncludesVat: false, compareInclVat: false, relatedValues: [] },
    [threshold],
  ),
});
describe('route-check response boundary', () => {
  for (const [amount, route] of [
    [100, 'no_tender_low_value'],
    [100.01, 'zuta_4'],
    [200, 'zuta_4'],
    [200.01, 'zuta_6'],
    [300, 'zuta_6'],
    [300.01, 'public_tender'],
  ] as const) {
    it(`preserves the server engine route and citation at ${String(amount)}`, () => {
      const response = resultSchema.parse(result(amount));
      assert.equal(response.route, route);
      assert.ok(response.regulation.length);
      assert.notEqual(routeLabel(response.route), 'מסלול הדורש בדיקה');
      assert.equal(response.comparedValue, amount);
    });
  }
  it('rejects answers without a citation or claiming needs_review is approval', () => {
    assert.equal(resultSchema.safeParse({ ...result(100), regulation: '' }).success, false);
    assert.equal(
      resultSchema.safeParse({ ...result(100), status: 'needs_review', allowed: true }).success,
      false,
    );
  });
  it('validates the calendar date and request identifier before sending', () => {
    assert.equal(
      checkInputSchema.safeParse({ request_id: 'bad', on: '2026-11-16' }).success,
      false,
    );
    assert.equal(
      checkInputSchema.safeParse({
        request_id: '10000000-0000-4000-8000-000000000001',
        on: '2026-02-30',
      }).success,
      false,
    );
  });
});

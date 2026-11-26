import assert from 'node:assert/strict';
import { it } from 'node:test';
import { previousThreshold, formatMoney, monthLabel } from '../model/comparison.ts';
import { proposalSchema, thresholdSchema } from '../api/proposals.ts';
const proposal = proposalSchema.parse({
  id: 'nov',
  valid_from: '2026-11-16',
  index_value: 120,
  no_tender_max: 100000,
  zuta4_max: 200000,
  zuta6_max: 300000,
  source: 'הלמ״ס',
  status: 'pending',
});
const threshold = thresholdSchema.parse({
  ...proposal,
  id: 'oct',
  valid_from: '2026-10-16',
  valid_until: '2026-11-15',
  is_official: false,
});
it('uses the threshold in force immediately before the proposed month, not a stale or future row', () => {
  const old = { ...threshold, id: 'old', valid_from: '2026-09-16', valid_until: '2026-10-15' };
  assert.equal(
    previousThreshold(proposal, [
      old,
      { ...threshold, id: 'future', valid_from: '2026-12-16' },
      threshold,
    ])?.id,
    'oct',
  );
  assert.equal(previousThreshold(proposal, [old]), null);
  assert.equal(previousThreshold(proposal, []), null);
});
it('formats Hebrew month and ILS, and rejects malformed proposals before rendering', () => {
  assert.match(monthLabel('2026-11-16'), /נובמבר/);
  assert.match(formatMoney(100000), /100,000/);
  for (const no_tender_max of [0, -1, Infinity])
    assert.equal(proposalSchema.safeParse({ ...proposal, no_tender_max }).success, false);
  assert.equal(proposalSchema.safeParse({ ...proposal, valid_from: '2026-02-30' }).success, false);
});
it('finds the thresholds in force on a day and labels the change', async () => {
  const { thresholdOn, changeLabel } = await import('../model/comparison.ts');
  assert.equal(thresholdOn('2026-11-01', [threshold])?.id, 'oct');
  assert.equal(thresholdOn('2026-12-01', [threshold]), null);
  assert.match(changeLabel(100000, 100400), /\+0\.4%/u);
  assert.match(changeLabel(100, 99), /-1%/u);
  assert.doesNotMatch(changeLabel(100, 100), /[+-]/u);
});

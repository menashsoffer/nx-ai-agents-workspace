// supplier-approaches-spec-he.md 7.4: every approach refusal the database sends has Hebrew
// text on the screen that can meet it, the staff screen or the supplier area.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { STAFF_APPROACH_REASONS } from '../src/features/route-check/model/approach-reasons.ts';
import { SUPPLIER_APPROACH_REASONS } from '../src/features/supplier-area/model/approach-reasons.ts';
import { reasonMessage } from '../src/lib/errors/reasons.ts';
import { serverKeys } from '../src/lib/errors/tests/server-keys.ts';

it('has text for every approach reason the database sends, and none extra', async () => {
  const raised = [...(await serverKeys())].filter((key) => key.startsWith('approach_')).sort();
  const texts = { ...STAFF_APPROACH_REASONS, ...SUPPLIER_APPROACH_REASONS };
  assert.deepEqual(raised, Object.keys(texts).sort());
  assert.equal(reasonMessage('reason:approach_amount'), texts.approach_amount);
});

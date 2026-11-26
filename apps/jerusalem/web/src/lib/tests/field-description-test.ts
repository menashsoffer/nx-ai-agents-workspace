import assert from 'node:assert/strict';
import { it } from 'node:test';
import { describedBy } from '../field-description.ts';
it('connects only existing descriptions, including caller-provided IDs', () => {
  assert.equal(describedBy('name', {}), undefined);
  assert.equal(
    describedBy('name', { hint: 'הנחיה', error: 'שגיאה', extra: 'format' }),
    'format name-hint name-error',
  );
  assert.equal(describedBy('name', { error: '', hint: 'הנחיה' }), 'name-hint');
});

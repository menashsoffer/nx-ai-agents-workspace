// excel-import-errors-spec-he.md section 5: every import refusal the database sends has
// Hebrew text, and the screen registers it for the shared error display.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { reasonMessage } from '../../../lib/errors/reasons.ts';
import { serverKeys } from '../../../lib/errors/tests/server-keys.ts';
import { IMPORT_REASONS, importRowError } from '../model/row-error.ts';

it('has text for every import reason the database sends, and none extra', async () => {
  const raised = [...(await serverKeys())].filter((key) => key.startsWith('import_')).sort();
  assert.deepEqual(raised, Object.keys(IMPORT_REASONS).sort());
  assert.equal(reasonMessage('reason:import_name_invalid'), IMPORT_REASONS.import_name_invalid);
});

it('explains an unexpected row failure with its code', () => {
  assert.match(importRowError('reason:import_row_failed:23505'), /קוד 23505/);
  assert.match(importRowError('reason:import_row_failed:bad'), /^השורה לא נקלטה בגלל תקלה במסד\./);
  assert.equal(importRowError('reason:identifier_taken'), reasonMessage('reason:identifier_taken'));
});

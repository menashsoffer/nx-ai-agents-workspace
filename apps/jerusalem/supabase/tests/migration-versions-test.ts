import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { it } from 'node:test';

// Supabase records each migration by its version prefix; two files with one version make
// `supabase db push` fail with a duplicate key on schema_migrations.
it('gives every migration its own version', () => {
  const dir = new URL('../migrations/', import.meta.url);
  const versions = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.split('_')[0]);
  const repeated = versions.filter((version, index) => versions.indexOf(version) !== index);
  assert.deepEqual(repeated, []);
});

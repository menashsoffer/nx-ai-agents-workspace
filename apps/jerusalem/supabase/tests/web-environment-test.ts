import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, setting } from '../../web/src/data/environment.ts';

describe('site environment', () => {
  it('uses the production project when nothing is set', () => {
    assert.equal(SUPABASE_URL, 'https://jzsvhjkiklfnogseelbe.supabase.co');
    assert.match(SUPABASE_PUBLISHABLE_KEY, /^sb_publishable_/);
  });

  it('treats an empty value from .env as unset', () => {
    assert.equal(setting('', 'fallback'), 'fallback');
    assert.equal(setting('  ', 'fallback'), 'fallback');
    assert.equal(setting(undefined, 'fallback'), 'fallback');
  });

  it('uses a value that is set', () => {
    assert.equal(setting(' http://127.0.0.1:54321 ', 'fallback'), 'http://127.0.0.1:54321');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { clearDraft, readDraft, writeDraft } from '../form-draft.ts';

const SCHEMA = z.object({ amount: z.string() });

function fakeStorage(fail = false) {
  const values = new Map<string, string>();
  const guard = () => {
    if (fail) throw new Error('blocked');
  };
  const fake = {
    getItem: (key: string) => (guard(), values.get(key) ?? null),
    setItem: (key: string, value: string) => (guard(), values.set(key, value)),
    removeItem: (key: string) => (guard(), values.delete(key)),
  };
  Object.defineProperty(globalThis, 'sessionStorage', { value: fake, configurable: true });
  return values;
}

describe('tab form drafts', () => {
  it('keeps a draft per key until it is cleared', () => {
    fakeStorage();
    writeDraft('a', { amount: '120000' });
    assert.deepEqual(readDraft('a', SCHEMA), { amount: '120000' });
    assert.equal(readDraft('b', SCHEMA), null);
    clearDraft('a');
    assert.equal(readDraft('a', SCHEMA), null);
  });

  it('drops a draft that no longer fits the form or is not JSON', () => {
    const values = fakeStorage();
    values.set('form-draft:old', JSON.stringify({ amount: 5 }));
    assert.equal(readDraft('old', SCHEMA), null);
    assert.equal(values.has('form-draft:old'), false);
    values.set('form-draft:broken', '{broken');
    assert.equal(readDraft('broken', SCHEMA), null);
    assert.equal(values.has('form-draft:broken'), false);
  });

  it('works without a draft when storage is blocked', () => {
    fakeStorage(true);
    writeDraft('a', { amount: '1' });
    clearDraft('a');
    assert.equal(readDraft('a', SCHEMA), null);
  });
});

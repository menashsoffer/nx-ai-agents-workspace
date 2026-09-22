import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exceptedTargets, validateExceptions } from './exceptions.mjs';

const today = new Date('2026-09-22T12:00:00Z');
const valid = {
  control: 'D2',
  target: 'GHSA-xxxx-yyyy-zzzz',
  reason: 'Dev-only advisory in a Storybook dependency; fix pending upstream.',
  owner: '@some-user',
  created: '2026-09-20',
  expires: '2026-12-01',
};

describe('validateExceptions', () => {
  it('accepts the shipped (empty) file', () => {
    const file = JSON.parse(
      readFileSync(join(import.meta.dirname, '../exceptions.json'), 'utf8'),
    );
    expect(file).toEqual([]);
    expect(validateExceptions(file, today)).toEqual([]);
  });

  it('accepts a complete entry, including @org/team owners', () => {
    expect(
      validateExceptions([valid, { ...valid, owner: '@acme/web' }], today),
    ).toEqual([]);
  });

  it.each([
    ['missing owner', { owner: undefined }, /owner/],
    ['_TODO_ owner', { owner: '_TODO_OWNER_' }, /owner/],
    ['owner without @', { owner: 'someone' }, /owner/],
    ['unknown control', { control: 'X9' }, /unknown control/],
    ['short reason', { reason: 'because' }, /20 characters/],
    ['more than 90 days', { expires: '2027-01-01' }, /90 days/],
    ['expired', { created: '2026-06-01', expires: '2026-09-01' }, /expired/],
    ['bad date', { created: '22/09/2026' }, /YYYY-MM-DD/],
    [
      'created in the future',
      { created: '2026-10-01', expires: '2026-12-01' },
      /future/,
    ],
  ])('rejects %s', (_label, change, message) => {
    const problems = validateExceptions([{ ...valid, ...change }], today);
    expect(problems.join('\n')).toMatch(message);
  });

  it('rejects a non-array file', () => {
    expect(validateExceptions({}, today)).toEqual([
      'exceptions.json must be a JSON array.',
    ]);
  });
});

describe('exceptedTargets', () => {
  it('returns targets for the given controls only', () => {
    const set = exceptedTargets(
      [valid, { ...valid, control: 'W2', target: 'x' }],
      ['D2'],
    );
    expect([...set]).toEqual(['GHSA-xxxx-yyyy-zzzz']);
  });
});

import { cn } from './cn.js';

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('p-2', false, undefined, 'ms-4', null, '')).toBe('p-2 ms-4');
  });

  it('flattens nested arrays of class names', () => {
    expect(cn(['p-2', ['ms-4', false]], 'text-start')).toBe(
      'p-2 ms-4 text-start',
    );
  });

  it('includes object keys whose value is truthy', () => {
    expect(cn({ 'p-2': true, 'ms-4': false, 'text-start': true })).toBe(
      'p-2 text-start',
    );
  });

  it('flattens arrays and objects mixed together', () => {
    expect(cn(['p-2', { 'ms-4': true, hidden: false }], 'text-start')).toBe(
      'p-2 ms-4 text-start',
    );
  });

  it('keeps conflicting Tailwind classes in call order instead of merging them', () => {
    // cn() concatenates; unlike `tailwind-merge`, it does not resolve or
    // dedupe conflicting utility classes.
    expect(cn('p-2', 'p-4')).toBe('p-2 p-4');
  });
});

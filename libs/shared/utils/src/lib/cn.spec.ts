import { cn } from './cn.js';

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('p-2', false, undefined, 'ms-4', null, '')).toBe('p-2 ms-4');
  });
});

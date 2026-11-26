import fc from 'fast-check';
import { cn } from './cn.js';

// Class names are single tokens without whitespace, like real Tailwind classes.
const classToken = fc.stringMatching(/^[a-z][a-z0-9:-]{0,11}$/);

describe('cn properties', () => {
  it('joins plain class names with single spaces, in order', () => {
    fc.assert(
      fc.property(fc.array(classToken, { maxLength: 8 }), (tokens) => {
        expect(cn(...tokens)).toBe(tokens.join(' '));
      }),
    );
  });

  it('ignores falsy values wherever they appear', () => {
    const falsy = fc.constantFrom(false as const, null, undefined, '');
    fc.assert(
      fc.property(
        fc.array(fc.oneof(classToken, falsy), { maxLength: 10 }),
        (values) => {
          const kept = values.filter(
            (value): value is string => typeof value === 'string' && !!value,
          );
          expect(cn(...values)).toBe(kept.join(' '));
        },
      ),
    );
  });

  it('flattening nested arrays does not change the result', () => {
    fc.assert(
      fc.property(
        fc.array(classToken, { maxLength: 6 }),
        fc.array(classToken, { maxLength: 6 }),
        (first, second) => {
          expect(cn([first, [second]])).toBe(cn(...first, ...second));
        },
      ),
    );
  });

  it('object form keeps exactly the enabled keys', () => {
    fc.assert(
      fc.property(
        fc.dictionary(classToken, fc.boolean(), { maxKeys: 8 }),
        (conditions) => {
          const enabled = Object.entries(conditions)
            .filter(([, isEnabled]) => isEnabled)
            .map(([className]) => className);
          expect(cn(conditions)).toBe(enabled.join(' '));
        },
      ),
    );
  });

  it('never emits leading, trailing or doubled spaces for token inputs', () => {
    fc.assert(
      fc.property(fc.array(classToken, { maxLength: 8 }), (tokens) => {
        expect(cn(...tokens)).not.toMatch(/^ | $| {2}/);
      }),
    );
  });
});

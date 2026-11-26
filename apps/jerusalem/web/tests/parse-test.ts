// The validators that every server row passes before the site uses it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DataError } from '../src/data/client.ts';
import {
  array,
  boolean,
  json,
  nullable,
  number,
  object,
  record,
  rows,
  text,
  tuple,
} from '../src/data/parse.ts';

const invalid = (action: () => unknown) => {
  assert.throws(action, (error: unknown) => error instanceof DataError && error.status === 0);
};

describe('scalar validators', () => {
  it('accept the right type and reject everything else', () => {
    assert.equal(text('a'), 'a');
    assert.equal(boolean(false), false);
    assert.equal(number(0), 0);
    invalid(() => text(1));
    invalid(() => boolean('true'));
    invalid(() => number('1'));
    invalid(() => number(Number.NaN));
    invalid(() => number(Infinity));
  });

  it('let null through only where allowed', () => {
    assert.equal(nullable(text)(null), null);
    assert.equal(nullable(text)('x'), 'x');
    invalid(() => nullable(text)(undefined));
  });
});

describe('containers', () => {
  it('tell objects from arrays and null', () => {
    assert.deepEqual(object({ a: 1 }), { a: 1 });
    invalid(() => object(null));
    invalid(() => object([]));
    invalid(() => object('x'));
    assert.deepEqual(array([1]), [1]);
    invalid(() => array({}));
  });

  it('copy JSON values deeply and reject non-finite numbers inside them', () => {
    const value = { a: [1, 'b', true, null, { c: 2 }] };
    assert.deepEqual(json(value), value);
    assert.equal(json(null), null);
    invalid(() => json({ a: [Infinity] }));
    invalid(() => json(undefined));
  });
});

describe('rows', () => {
  const schema = { id: text, count: number };

  it('reads compact tuples of exactly the declared length', () => {
    assert.deepEqual(tuple(['a', 1], schema), { id: 'a', count: 1 });
    assert.deepEqual(rows([['a', 1]], schema), [{ id: 'a', count: 1 }]);
    invalid(() => tuple(['a'], schema));
    invalid(() => tuple(['a', 1, 2], schema));
    invalid(() => rows([['a', 'x']], schema));
  });

  it('reads named records and validates every declared field', () => {
    assert.deepEqual(record({ id: 'a', count: 2, extra: true }, schema), { id: 'a', count: 2 });
    invalid(() => record({ id: 'a' }, schema));
  });
});

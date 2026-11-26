import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluate, INITIAL_BUDGET_BYTES, initialScripts, LAZY_BUDGET_BYTES } from '../budget.ts';

const PAGE = [
  '<script type="module" crossorigin src="./assets/admin-1.js"></script>',
  '<link rel="modulepreload" crossorigin href="./assets/shared-2.js">',
  '<link rel="stylesheet" href="./assets/admin-3.css">',
].join('');

describe('initialScripts', () => {
  it('returns the entry script and its preloads, not stylesheets', () => {
    assert.deepEqual(initialScripts(PAGE), ['assets/admin-1.js', 'assets/shared-2.js']);
  });

  it('returns nothing for a page without module scripts', () => {
    assert.deepEqual(initialScripts('<p>שלום</p>'), []);
  });
});

describe('evaluate', () => {
  const pages = { 'admin.html': ['assets/admin-1.js', 'assets/shared-2.js'] };

  it('passes at exactly the budget', () => {
    const sizes = {
      'assets/admin-1.js': INITIAL_BUDGET_BYTES - 10,
      'assets/shared-2.js': 10,
      'assets/screen.js': LAZY_BUDGET_BYTES,
    };
    assert.deepEqual(evaluate({ pages, sizes }).failures, []);
  });

  it('fails one byte over the initial budget, summing the preloads', () => {
    const sizes = { 'assets/admin-1.js': INITIAL_BUDGET_BYTES, 'assets/shared-2.js': 1 };
    assert.equal(evaluate({ pages, sizes }).failures.length, 1);
  });

  it('counts a chunk no page loads first as lazy', () => {
    const sizes = { 'assets/admin-1.js': 1, 'assets/screen.js': LAZY_BUDGET_BYTES + 1 };
    assert.deepEqual(evaluate({ pages, sizes }).failures, ['assets/screen.js is 40.0KB']);
  });
});

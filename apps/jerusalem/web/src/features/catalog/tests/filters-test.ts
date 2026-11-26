import { suppliers } from './fixture.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { optionsFor, emptyFilters, changeFilter, reconcile } from '../model/filters.ts';
import { linkedFilters, restoreFilters, saveFilters } from '../model/saved-filters.ts';
import { clearKeys } from '../model/filter-groups.ts';
describe('catalog filter choices', () => {
  it('deduplicates roots and offers children only under the selected root', () => {
    const options = optionsFor(suppliers(), { registry: 'r1', category: 'root' });
    assert.deepEqual(options.category, [{ value: 'root', label: 'הנדסה' }]);
    assert.deepEqual(
      options.subcategory.map((c) => c.value),
      ['c1', 'c2'],
    );
  });
  it('resets incompatible fields, units and categories on registry change', () => {
    const current = {
      ...emptyFilters('2026-11-16'),
      registry: 'r1',
      field: 'f1',
      category: 'root',
      subcategory: 'c1',
      unit: 'u1',
      query: 'שם קודם',
    };
    assert.deepEqual(changeFilter(current, { key: 'registry', value: 'r2' }, suppliers()), {
      ...emptyFilters('2026-11-16'),
      registry: 'r2',
      query: 'שם קודם',
    });
  });
  it('removes disappeared selections after a refreshed catalog', () => {
    const current = {
      ...emptyFilters('2026-11-16'),
      registry: 'gone',
      field: 'gone',
      unit: 'gone',
    };
    assert.deepEqual(reconcile(current, suppliers()), emptyFilters('2026-11-16'));
  });
});

describe('saved catalog search', () => {
  it('restores filters saved for the same history entry and rejects other shapes', () => {
    const values = new Map<string, string>();
    const fake = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
    };
    Object.defineProperty(globalThis, 'sessionStorage', { value: fake, configurable: true });
    const fresh = emptyFilters('2026-11-17');
    saveFilters('a', { ...fresh, query: 'חירום', today: '2026-11-01' });
    assert.deepEqual(restoreFilters('a', fresh), { ...fresh, query: 'חירום' });
    assert.equal(restoreFilters('b', fresh), null);
    values.set('catalog-filters:c', JSON.stringify({ ...fresh, showInactive: 'yes' }));
    assert.equal(restoreFilters('c', fresh), null);
    values.set('catalog-filters:d', '{broken');
    assert.equal(restoreFilters('d', fresh), null);
  });
});

describe('a search handed over by a link', () => {
  const fresh = emptyFilters('2026-11-25');
  it('takes the query, registry and validity and nothing else', () => {
    const state = { query: '  הדרכה ', registry: 'r1', validity: 'expired', showInactive: true };
    assert.deepEqual(linkedFilters(state, fresh), {
      ...fresh,
      query: 'הדרכה',
      registry: 'r1',
      validity: 'expired',
    });
  });
  it('ignores missing, empty or unknown values', () => {
    assert.equal(linkedFilters(null, fresh), null);
    assert.equal(linkedFilters('text', fresh), null);
    assert.equal(linkedFilters({ query: ' ', validity: 'soon' }, fresh), null);
    assert.equal(linkedFilters({ registry: 7 }, fresh), null);
  });
});

describe('clearing the filters dialog', () => {
  it('clears only the given filters and both toggles', () => {
    const set = {
      ...emptyFilters('2026-11-22'),
      query: 'ספק',
      registry: 'r1',
      category: 'root',
      subcategory: 'c1',
      showInactive: true,
      showClosed: true,
    };
    const next = clearKeys(set, ['category', 'subcategory']);
    assert.equal(next.registry, 'r1');
    assert.equal(next.query, 'ספק');
    assert.equal(next.category, '');
    assert.equal(next.subcategory, '');
    assert.equal(next.showInactive, false);
    assert.equal(next.showClosed, false);
  });
});

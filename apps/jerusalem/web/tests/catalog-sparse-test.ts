// The catalog model with missing references: nothing invented, nothing shown without a pool.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCatalog, validity, type Membership } from '../src/catalog-model.ts';
import { compactCatalog } from '../src/data/compact-catalog.ts';
import { SUPPLIER, wireCatalog } from './catalog-fixture.ts';

function data() {
  return compactCatalog(wireCatalog());
}

function membership(over: Partial<Membership>): Membership {
  return { validFrom: null, validUntil: null, ...over } as Membership;
}

describe('validity', () => {
  it('tells future, undated, expired and valid registrations apart', () => {
    const today = '2026-11-17';
    assert.equal(validity(membership({ validFrom: '2026-11-18' }), today), 'future');
    assert.equal(validity(membership({ validFrom: today }), today), 'undated');
    assert.equal(validity(membership({ validUntil: '2026-11-16' }), today), 'expired');
    assert.equal(validity(membership({ validUntil: today }), today), 'valid');
  });
});

describe('buildCatalog with sparse data', () => {
  it('leaves out unknown fields, units, documents and categories', () => {
    const catalog = data();
    catalog.memberships = catalog.memberships.map((m) => ({ ...m, registry_field_id: null }));
    catalog.registries = catalog.registries.map((r) => ({ ...r, owner_unit_id: 'missing' }));
    catalog.versions = catalog.versions.map((v) => ({ ...v, source_document_id: null }));
    const [supplier] = buildCatalog(catalog);
    const [item] = supplier?.memberships ?? [];
    assert.ok(item);
    assert.equal(item.fieldId, null);
    assert.equal(item.field, '');
    assert.equal(item.unit, '');
    assert.equal(item.source, null);
    assert.deepEqual(item.categories, []);
  });

  it('skips a category link to a missing category and a parent that is not loaded', () => {
    const catalog = data();
    catalog.fieldCategories = [
      { registry_field_id: 'f1', category_id: 'missing' },
      { registry_field_id: 'f1', category_id: 'c1' },
    ];
    catalog.categories = catalog.categories.filter((c) => c.id !== 'root');
    const categories = buildCatalog(catalog)[0]?.memberships[0]?.categories;
    assert.deepEqual(categories, [
      { categoryId: 'c1', categoryName: 'כבישים', parentCategoryId: null, parentCategoryName: '' },
    ]);
  });

  it('notes an inactive supplier without a reason, and hides merged suppliers', () => {
    const catalog = data();
    const [row] = catalog.suppliers;
    assert.ok(row);
    catalog.suppliers = [
      { ...row, status: 'inactive' },
      { ...row, id: 'merged', status: 'merged' },
    ];
    const suppliers = buildCatalog(catalog);
    assert.deepEqual(
      suppliers.map((s) => s.id),
      [SUPPLIER],
    );
    assert.deepEqual(suppliers[0]?.inactive, {
      reason: 'לא צוינה סיבה',
      source: null,
      changedOn: null,
    });
  });

  it('drops rejected memberships, and with them a supplier that has no other pool', () => {
    const catalog = data();
    catalog.memberships = catalog.memberships.map((m) => ({ ...m, review_status: 'rejected' }));
    assert.deepEqual(buildCatalog(catalog), []);
  });

  it('keeps a published name only when the pool printed one', () => {
    const catalog = data();
    catalog.memberships = catalog.memberships.map((m) => ({ ...m, name_as_published: null }));
    catalog.names = [];
    catalog.contactKinds = [];
    const [supplier] = buildCatalog(catalog);
    assert.ok(supplier);
    assert.deepEqual(supplier.aliases, []);
    assert.deepEqual(supplier.contactKinds, []);
  });
});

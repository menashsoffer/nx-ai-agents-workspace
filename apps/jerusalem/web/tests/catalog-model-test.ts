import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { buildCatalog } from '../src/catalog-model.ts';
import { filterCatalog, type Filters } from '../src/catalog-filter.ts';
import { normalize } from '../src/catalog-search.ts';
import { compactCatalog } from '../src/data/compact-catalog.ts';
import { SUPPLIER, wireCatalog } from './catalog-fixture.ts';

const FILTERS: Filters = {
  query: '',
  registry: '',
  field: '',
  category: '',
  subcategory: '',
  unit: '',
  validity: '',
  identifier: '',
  venue: '',
  showInactive: false,
  showClosed: false,
  today: '2026-11-16',
};

describe('compact catalog and precomputed search', () => {
  it('rejects a nested position that points past its array', () => {
    const wire = wireCatalog();
    const [row] = wire.suppliers;
    assert.ok(row);
    const broken = [...row];
    broken[8] = [[9, null, 0, null, null, null, null, null, null]];
    assert.throws(() => compactCatalog({ ...wire, suppliers: [broken] }));
  });

  it('restores inherited names and encoded defaults without replacing genuinely missing names', () => {
    const catalog = compactCatalog({
      ...wireCatalog(),
      suppliers: [
        [
          SUPPLIER,
          'שם ספק',
          null,
          null,
          null,
          null,
          null,
          [[0, null, null]],
          [
            [0, 0, 0, null, null, null, null, null, null],
            [1, 1, null, null, null, null, null, null, null],
          ],
          [],
          null,
          null,
          null,
        ],
      ],
    });
    assert.equal(catalog.suppliers[0]?.entity_kind, 'unknown');
    assert.equal(catalog.suppliers[0].status, 'active');
    assert.equal(catalog.names[0]?.name, 'שם ספק');
    assert.equal(catalog.names[0].kind, 'as_published');
    assert.equal(catalog.memberships[0]?.name_as_published, 'שם ספק');
    assert.equal(catalog.memberships[0].dates_source, 'unknown');
    assert.equal(catalog.memberships[0].review_status, 'needs_review');
    assert.equal(catalog.memberships[1]?.name_as_published, null);
  });

  it('retains source information, dates, contact kinds and all field categories', () => {
    const data = compactCatalog(wireCatalog());
    const [supplier] = buildCatalog(data);
    assert.ok(supplier);
    assert.deepEqual(supplier.contactKinds, ['email']);
    assert.equal(data.names[0]?.source_document_id, 'd1');
    assert.equal(data.versions[1]?.registry_id, 'r2');
    assert.equal(data.fields[1]?.registry_id, 'r2');
    assert.equal(supplier.memberships[0]?.source, 'https://example.test/source');
    assert.equal(supplier.memberships[0].validUntil, '2028-01-01');
    assert.deepEqual(
      supplier.memberships[0].categories.map((category) => category.categoryId),
      ['c1', 'c2'],
    );
    for (const subcategory of ['c1', 'c2']) {
      assert.equal(
        filterCatalog([supplier], { ...FILTERS, subcategory, category: 'root', registry: 'r1' })
          .length,
        1,
      );
      assert.equal(
        filterCatalog([supplier], { ...FILTERS, subcategory, registry: 'r2' }).length,
        0,
      );
    }
  });

  it('matches the former normalization behavior for names, aliases and filtered fields', () => {
    const suppliers = buildCatalog(compactCatalog(wireCatalog()));
    for (const query of [
      'שם נוכחי',
      'שם—קודם',
      'כתיב נוסף',
      'תכנון',
      'כבישים',
      'תְכנוּן',
      'missing',
      'שם!נוכחי',
      'ＳＴＲＩＮＧ',
      '',
    ]) {
      for (const registry of ['', 'r1', 'r2']) {
        const expected = suppliers.filter((supplier) => {
          const members = supplier.memberships.filter(
            (member) => !registry || member.registryId === registry,
          );
          if (registry && !members.length) return false;
          const term = normalize(query);
          return (
            !term ||
            [supplier.name, ...supplier.aliases].some((name) => normalize(name).includes(term)) ||
            members.some((member) => normalize(member.field).includes(term))
          );
        });
        assert.deepEqual(filterCatalog(suppliers, { ...FILTERS, query, registry }), expected);
      }
    }
  });

  it('normalizes only the query on each keystroke', () => {
    const suppliers = buildCatalog(compactCatalog(wireCatalog()));
    const spy = mock.method(String.prototype, 'normalize');
    try {
      filterCatalog(suppliers, { ...FILTERS, query: 'שם' });
      assert.equal(spy.mock.callCount(), 1);
    } finally {
      spy.mock.restore();
    }
  });

  it('rejects incomplete tuples and wrong column types before building a model', () => {
    assert.throws(() => compactCatalog({ ...wireCatalog(), registries: [['id']] }));
    const invalid = wireCatalog();
    assert.throws(() => compactCatalog({ ...invalid, suppliers: [[1, 'bad']] }));
  });
});

// Ported from tests/catalog-model.test.cjs (task R12): filters match on one membership.
describe('catalog filters on a 533-supplier catalog', () => {
  function large() {
    const data = compactCatalog(wireCatalog());
    const [first] = data.suppliers;
    const [member] = data.memberships;
    assert.ok(first && member);
    data.suppliers = Array.from({ length: 533 }, (_, i) => ({
      ...first,
      id: i === 0 ? SUPPLIER : `s${String(i)}`,
      display_name: i === 0 ? first.display_name : `ספק ${String(i)}`,
    }));
    data.memberships = [
      member,
      { ...member, registry_version_id: 'v2', registry_field_id: 'f2', registered_until: null },
      ...data.suppliers.slice(1).map((s) => ({ ...member, supplier_id: s.id })),
    ];
    return data;
  }

  it('keeps each supplier once and matches combined filters on the same membership', () => {
    const rows = buildCatalog(large());
    assert.equal(rows.length, 533);
    const own = (filters: Partial<Filters>) =>
      filterCatalog(rows, { ...FILTERS, ...filters }).some((row) => row.id === SUPPLIER);
    assert.equal(own({ registry: 'r1', field: 'f1', unit: 'u1', validity: 'valid' }), true);
    assert.equal(own({ registry: 'r1', field: 'f2' }), false);
    assert.equal(own({ registry: 'r2', validity: 'undated' }), true);
    assert.equal(own({ category: 'root', registry: 'r2' }), false);
  });

  it('omits a supplier whose only membership points to an unknown pool version', () => {
    const data = large();
    const [member] = data.memberships;
    const other = data.suppliers[1];
    assert.ok(member && other);
    data.suppliers.push({ ...other, id: 'broken' });
    data.memberships.push({ ...member, supplier_id: 'broken', registry_version_id: 'missing' });
    assert.equal(
      buildCatalog(data).some((row) => row.id === 'broken'),
      false,
    );
  });

  it('filters the catalog in under one second', () => {
    const rows = buildCatalog(large());
    const start = performance.now();
    assert.ok(filterCatalog(rows, { ...FILTERS, query: 'ספק 5' }).length > 0);
    assert.ok(performance.now() - start < 1000);
  });
});

describe('status filters', () => {
  function catalog(status: string | null, registryStatus: string) {
    const wire = wireCatalog();
    const [row] = wire.suppliers;
    assert.ok(row);
    const supplier: unknown[] = [...row];
    supplier[3] = status;
    supplier[11] = status === 'inactive' ? ['מונתה לשופטת', null, '2026-09-01'] : null;
    const registries = wire.registries.map((r) =>
      r[0] === 'r1' ? [r[0], r[1], r[2], registryStatus] : r,
    );
    return buildCatalog(compactCatalog({ ...wire, registries, suppliers: [supplier] }));
  }

  it('hides an inactive supplier unless asked for or found by its own name', () => {
    const suppliers = catalog('inactive', 'active');
    assert.equal(suppliers[0]?.inactive?.reason, 'מונתה לשופטת');
    assert.equal(filterCatalog(suppliers, FILTERS).length, 0);
    assert.equal(filterCatalog(suppliers, { ...FILTERS, showInactive: true }).length, 1);
    assert.equal(filterCatalog(suppliers, { ...FILTERS, query: 'שם נוכחי' }).length, 1);
    assert.equal(filterCatalog(suppliers, { ...FILTERS, query: 'כבישים' }).length, 0);
  });

  it('hides memberships in closed registries by default', () => {
    const suppliers = catalog(null, 'closed');
    assert.equal(suppliers[0]?.memberships[0]?.registryClosed, true);
    assert.equal(filterCatalog(suppliers, FILTERS).length, 0);
    assert.equal(filterCatalog(suppliers, { ...FILTERS, showClosed: true }).length, 1);
  });

  it('filters by identifier state', () => {
    const suppliers = catalog(null, 'active');
    assert.equal(filterCatalog(suppliers, { ...FILTERS, identifier: 'verified' }).length, 1);
    assert.equal(filterCatalog(suppliers, { ...FILTERS, identifier: 'pending' }).length, 0);
    assert.equal(filterCatalog(suppliers, { ...FILTERS, identifier: 'none' }).length, 0);
  });

  it('keeps only venues, and only those with enough seats when asked', () => {
    const wire = wireCatalog();
    const [row] = wire.suppliers;
    assert.ok(row);
    const hall: unknown[] = [...row];
    hall[12] = [180, '180 מקומות', null, null, null, null, null, 2024];
    const suppliers = buildCatalog(compactCatalog({ ...wire, suppliers: [hall] }));
    assert.equal(suppliers[0]?.venue?.capacity, 180);
    assert.equal(filterCatalog(suppliers, { ...FILTERS, venue: 'venue' }).length, 1);
    assert.equal(filterCatalog(suppliers, { ...FILTERS, venue: '100' }).length, 1);
    assert.equal(filterCatalog(suppliers, { ...FILTERS, venue: '200' }).length, 0);
    const plain = catalog(null, 'active');
    assert.equal(filterCatalog(plain, { ...FILTERS, venue: 'venue' }).length, 0);
    hall[12] = [180];
    assert.throws(() => compactCatalog({ ...wire, suppliers: [hall] }));
  });
});

describe('registration validity', () => {
  function withDates(own: string | null, registry: string | null) {
    const data = compactCatalog(wireCatalog());
    const [member] = data.memberships;
    const [version] = data.versions;
    assert.ok(member && version);
    data.versions = [{ ...version, valid_until: registry }];
    data.memberships = [{ ...member, registry_version_id: version.id, registered_until: own }];
    const [row] = buildCatalog(data);
    return row?.memberships[0]?.validUntil;
  }

  it('takes the registry date when the supplier has none, and the supplier date first', () => {
    assert.equal(withDates(null, '2026-12-24'), '2026-12-24');
    assert.equal(withDates('2026-06-30', '2026-12-24'), '2026-06-30');
    assert.equal(withDates(null, null), null);
  });
});

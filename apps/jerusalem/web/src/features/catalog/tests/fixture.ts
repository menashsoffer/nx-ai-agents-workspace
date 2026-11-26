import assert from 'node:assert/strict';
import { buildCatalog, type Supplier } from '../../../catalog-model.ts';
import { compactCatalog } from '../../../data/compact-catalog.ts';
import { wireCatalog, access, USER } from '../../../../tests/catalog-fixture.ts';
import type { CatalogState } from '../../../data/snapshot.ts';
export function suppliers(): Supplier[] {
  const [first] = buildCatalog(compactCatalog(wireCatalog()));
  assert.ok(first);
  const member = first.memberships[0];
  assert.ok(member);
  return [
    first,
    {
      ...first,
      id: 'other',
      name: 'ספק אחר',
      searchNames: ['ספק אחר'],
      contactKinds: [],
      memberships: [
        {
          ...member,
          registryId: 'r2',
          registry: 'מאגר ב',
          fieldId: 'f2',
          field: 'ניהול',
          categories: [],
          unitId: 'u2',
          unit: 'אגף ב',
          validUntil: '2020-01-01',
        },
      ],
    },
  ];
}

export function state(): CatalogState {
  return {
    userId: USER,
    version: '1',
    access: access(),
    catalog: compactCatalog(wireCatalog()),
    suppliers: suppliers(),
    refreshing: false,
    timings: { request_ms: '0', model_ms: '0' },
  };
}

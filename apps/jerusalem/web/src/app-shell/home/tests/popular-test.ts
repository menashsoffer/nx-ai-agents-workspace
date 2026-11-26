import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Membership, Supplier } from '../../../catalog-model.ts';
import { busiestRegistries, greeting } from '../model/popular.ts';

function member(registryId: string, registryClosed = false): Membership {
  return {
    registryId,
    registry: `מאגר ${registryId}`,
    fieldId: null,
    field: '',
    searchText: '',
    categories: [],
    unitId: null,
    unit: '',
    validFrom: null,
    validUntil: null,
    source: null,
    page: null,
    reviewStatus: 'verified',
    registryClosed,
  };
}

function supplier(id: string, memberships: Membership[], inactive = false): Supplier {
  return {
    id,
    name: id,
    aliases: [],
    searchNames: [],
    verified: false,
    identifier: null,
    inactive: inactive ? { reason: 'closed', source: null, changedOn: null } : null,
    memberships,
    contactKinds: [],
    venue: null,
  };
}

describe('the chips under the home search', () => {
  it('counts each active supplier once per open registry, most first', () => {
    const suppliers = [
      supplier('s1', [member('a'), member('a'), member('b')]),
      supplier('s2', [member('b'), member('c', true)]),
      supplier('s3', [member('b')], true),
      supplier('s4', [member('d')]),
    ];
    assert.deepEqual(
      busiestRegistries(suppliers).map((r) => [r.id, r.count]),
      [
        ['b', 2],
        ['a', 1],
        ['d', 1],
      ],
    );
    assert.deepEqual(busiestRegistries([]), []);
  });
});

describe('the greeting', () => {
  it('follows the hour in Jerusalem', () => {
    assert.equal(greeting(new Date('2026-11-26T06:00:00Z')), 'בוקר טוב');
    assert.equal(greeting(new Date('2026-11-26T11:00:00Z')), 'צהריים טובים');
    assert.equal(greeting(new Date('2026-11-26T16:00:00Z')), 'ערב טוב');
    assert.equal(greeting(new Date('2026-11-26T21:00:00Z')), 'לילה טוב');
  });
});

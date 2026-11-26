import assert from 'node:assert/strict';
import { it } from 'node:test';

import { supplierDetail } from '../src/data/supplier-detail.ts';
import { compactCatalog } from '../src/data/compact-catalog.ts';
import {
  client,
  requestBody,
  requestUrl,
  SUPPLIER,
  wireCatalog,
  wireDetail,
} from './catalog-fixture.ts';

const AUDIT = {
  id: 1,
  row_id: 'deleted',
  table_name: 'supplier_contacts',
  operation: 'DELETE',
  changes: { supplier_id: { old: SUPPLIER, new: null } },
  created_at: '2026-11-12T12:00:00Z',
};

it('loads identifiers, contacts and permitted audit in one RPC, including deleted rows', async () => {
  const cached = compactCatalog(wireCatalog());
  for (const audit of [null, [AUDIT]]) {
    let requests = 0;
    const api = client((url, init) => {
      requests++;
      assert.match(requestUrl(url), /rpc\/supplier_detail$/);
      assert.deepEqual(requestBody(init), { supplier_id: SUPPLIER });
      return Response.json(wireDetail({ audit }));
    });
    const detail = await supplierDetail(api, cached, SUPPLIER);
    assert.equal(requests, 1);
    assert.equal(detail.supplier.display_name, 'שם נוכחי');
    assert.deepEqual(detail.audit, audit);
    assert.deepEqual(
      detail.contacts.map((row) => [row.value, row.is_valid, row.supplier_id]),
      [['bad', false, SUPPLIER]],
    );
  }
});

it('rejects an invalid or unknown supplier without requesting data, and validates the reply', async () => {
  const cached = compactCatalog(wireCatalog());
  let requests = 0;
  const api = client(() => {
    requests++;
    return Response.json({ identifiers: 'bad', audit: null });
  });
  await assert.rejects(supplierDetail(api, cached, 'invalid'));
  await assert.rejects(supplierDetail(api, cached, '40000000-0000-0000-0000-000000000099'));
  assert.equal(requests, 0);
  await assert.rejects(supplierDetail(api, cached, SUPPLIER));
  assert.equal(requests, 1);
});

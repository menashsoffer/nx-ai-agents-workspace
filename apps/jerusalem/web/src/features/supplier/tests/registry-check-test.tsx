// Spec 6.3: before a name or kind change is checked, the registries are asked about the
// supplier's numbers. A failure there never stops the edit.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import * as rpc from '../../../data/rpc.ts';
import { START, runEdit } from '../api/edit-flow.ts';
import { refreshRegistry } from '../api/registry-check.ts';
import { KIND, NAME } from '../model/edit-form.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const data = {
  supplier: { id: 's1', display_name: 'ספק', entity_kind: 'unknown' },
  contacts: [],
} as unknown as SupplierDetail;

function form(name: string, kind = 'unknown'): FormData {
  const values = new FormData();
  values.set(NAME, name);
  values.set(KIND, kind);
  return values;
}

describe('registry check before an edit is checked', () => {
  it('posts the supplier with the user token and ignores a failure', async () => {
    vi.spyOn(rpc, 'freshToken').mockResolvedValue('token');
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    await refreshRegistry('s1', fetcher);
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/\/functions\/v1\/supplier-change-check$/u);
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    expect(init.body).toBe('{"supplier_id":"s1"}');
  });

  it('asks the registry for a rename, then checks in the database', async () => {
    vi.spyOn(rpc, 'freshToken').mockResolvedValue('token');
    const order: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      order.push('registry');
      return Promise.resolve(new Response('{}'));
    });
    vi.spyOn(rpc, 'rpc').mockImplementation((name) => {
      order.push(name);
      return Promise.resolve({ outcome: 'yellow', checks: [] });
    });
    const state = await runEdit(START, form('ספק חדש'), { data, admin: false });
    expect(order).toEqual(['registry', 'check_supplier_change']);
    expect(state.checked).toHaveLength(1);
  });

  it('checks a kind change too, even when the registry is down', async () => {
    vi.spyOn(rpc, 'freshToken').mockRejectedValue(new Error('signed out'));
    const check = vi.spyOn(rpc, 'rpc').mockResolvedValue({ outcome: 'green', checks: [] });
    await runEdit(START, form('ספק', 'company'), { data, admin: false });
    expect(check).toHaveBeenCalledWith(
      'check_supplier_change',
      expect.anything(),
      expect.anything(),
    );
  });
});

// Supplier spec 4.6: the address is a map link, an unfound address keeps a note, and a
// saved address is checked right away.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import * as rpc from '../../../data/rpc.ts';
import { requestAddressCheck } from '../api/address-check.ts';
import { submitChanges } from '../api/changes.ts';
import { ContactCard } from '../components/contact-card.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('address note on the supplier page', () => {
  const contact = (map: { result: string; label: string | null } | null) => ({
    id: 'a',
    supplier_id: 's',
    kind: 'address',
    value: 'אין כזה 1, ירושלים',
    is_valid: true,
    source_document_id: null,
    status: 'current',
    map,
  });

  it('keeps an unfound address visible with a note', () => {
    render(<ContactCard contacts={[contact({ result: 'not_found', label: null })]} />);
    expect(screen.getByText('אין כזה 1, ירושלים')).toBeDefined();
    expect(screen.getByText('הכתובת לא אותרה במפה')).toBeDefined();
  });

  it('adds no note to a found or unchecked address', () => {
    render(<ContactCard contacts={[contact({ result: 'found', label: 'x' }), contact(null)]} />);
    expect(screen.queryByText('הכתובת לא אותרה במפה')).toBeNull();
  });
});

describe('address check after a save', () => {
  it('posts to the function and ignores a failure', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    requestAddressCheck(fetcher);
    await Promise.resolve();
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/\/functions\/v1\/address-check$/u);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('asks for a check only when a saved change is an address', async () => {
    const answer = { request_id: 'r', status: 'applied', outcome: 'green', checks: [] };
    vi.spyOn(rpc, 'rpc').mockResolvedValue(answer);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const contact = { supplier_id: 's', kind: 'contact' as const, contact_kind: 'email' };
    await submitChanges([{ ...contact, value: 'a@b.co.il' }], '');
    expect(fetcher).not.toHaveBeenCalled();
    await submitChanges([{ ...contact, contact_kind: 'address', value: 'יפו 1, ירושלים' }], '');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

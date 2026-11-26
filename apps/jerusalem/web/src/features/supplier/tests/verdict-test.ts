import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { verdict } from '../model/verdict.ts';

const TODAY = '2026-11-25';

interface Listing {
  until?: string | null;
  from?: string | null;
  review?: string;
  versionUntil?: string | null;
  closed?: boolean;
}

function detail(listings: Listing[], extra: Record<string, unknown> = {}): SupplierDetail {
  return {
    supplier: { id: 's', display_name: 'ספק', status: 'active', review_status: 'needs_review' },
    names: [],
    identifiers: [{ id: 'i', scheme: 'company', value: '512345678', review_status: 'verified' }],
    contacts: [],
    memberships: listings.map((l, i) => ({
      registry_version_id: `v${String(i)}`,
      registered_until: l.until ?? null,
      registered_from: l.from ?? null,
      review_status: l.review ?? 'verified',
    })),
    versions: listings.map((l, i) => ({
      id: `v${String(i)}`,
      registry_id: `r${String(i)}`,
      valid_from: null,
      valid_until: l.versionUntil ?? null,
    })),
    registries: listings.map((l, i) => ({
      id: `r${String(i)}`,
      name: `מאגר ${String(i)}`,
      status: l.closed ? 'closed' : 'active',
    })),
    fields: [],
    documents: [],
    audit: null,
    ...extra,
  } as unknown as SupplierDetail;
}

describe('the supplier verdict band', () => {
  it('allows a verified listing in a registry that is still valid, and says until when', () => {
    const result = verdict(detail([{ versionUntil: '2026-12-24' }]), TODAY);
    assert.equal(result.label, 'מותר');
    assert.equal(result.summary, 'עד 24.12.2026.');
    assert.equal(result.rows.at(-1)?.state, 'none');
  });

  it('lets the supplier’s own date win over the registry validity', () => {
    const result = verdict(detail([{ until: '2026-11-07', versionUntil: '2027-12-31' }]), TODAY);
    assert.equal(result.kind, 'blocked');
    assert.equal(result.rows[0]?.detail, 'מאגר 0, פג ב-07.11.2026');
  });

  it('asks to check a listing nobody verified, an undated one, or a missing identifier', () => {
    const unverified = verdict(detail([{ until: '2027-01-01', review: 'needs_review' }]), TODAY);
    assert.equal(unverified.label, 'לבדוק');
    assert.equal(unverified.summary, 'השיוך למאגר עוד לא נבדק.');
    assert.equal(verdict(detail([{}]), TODAY).rows[0]?.title, 'לא ידוע עד מתי הרישום בתוקף');
    const noId = verdict(detail([{ until: '2027-01-01' }], { identifiers: [] }), TODAY);
    assert.equal(noId.rows[2]?.title, 'אין מספר מזהה');
    const pending = [{ id: 'i', scheme: 'company', value: '1', review_status: 'needs_review' }];
    const unapproved = verdict(detail([{ until: '2027-01-01' }], { identifiers: pending }), TODAY);
    assert.equal(unapproved.rows[2]?.title, 'מספר מזהה עוד לא אושר');
  });

  it('does not count a closed registry or a listing that has not started', () => {
    assert.equal(verdict(detail([{ until: '2027-01-01', closed: true }]), TODAY).kind, 'blocked');
    const future = verdict(detail([{ from: '2027-01-01', until: '2028-01-01' }]), TODAY);
    assert.equal(future.rows[0]?.title, 'הרישום עוד לא התחיל');
    assert.equal(future.kind, 'check');
  });

  it('blocks an inactive supplier whatever the registry says', () => {
    const inactive = { id: 's', status: 'inactive', status_reason: 'פירוק', display_name: 'x' };
    const result = verdict(detail([{ until: '2027-01-01' }], { supplier: inactive }), TODAY);
    assert.equal(result.kind, 'blocked');
    assert.equal(result.summary, 'הספק סומן כלא פעיל.');
    assert.equal(result.rows[0]?.detail, 'פירוק');
  });
});

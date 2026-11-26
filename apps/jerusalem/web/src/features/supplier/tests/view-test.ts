import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { contactLink } from '../model/contact-links.ts';
import { historyDays, sentence } from '../model/history.ts';
import {
  alsoKnownAs,
  cityOf,
  headerBadges,
  listings,
  summaryParts,
  verificationMark,
  verificationNote,
} from '../model/view.ts';

const TODAY = '2026-11-17';
function detail(overrides: Partial<SupplierDetail> = {}): SupplierDetail {
  return {
    supplier: {
      id: 's',
      display_name: '"ישרא-טים" 98 בע"מ',
      entity_kind: 'company',
      status: 'active',
      review_status: 'needs_review',
    },
    names: [{ name: 'ישראטים' }, { name: '"ישרא-טים" 98 בע"מ' }, { name: 'ישראטים 98 בע"מ' }],
    identifiers: [
      { id: 'i', scheme: 'company', value: '512679903', review_status: 'needs_review' },
    ],
    contacts: [{ id: 'c', kind: 'address', value: 'הזמר העברי 96, הרצליה 4606400' }],
    memberships: [
      { registry_version_id: 'v18', registry_field_id: 'f1', review_status: 'needs_review' },
      { registry_version_id: 'v20', registry_field_id: 'f2', review_status: 'needs_review' },
      { registry_version_id: 'v20', registry_field_id: 'f3', review_status: 'needs_review' },
    ],
    versions: [
      { id: 'v18', registry_id: 'r18', source_document_id: 'd', valid_until: '2020-12-31' },
      { id: 'v20', registry_id: 'r20', source_document_id: 'd' },
    ],
    registries: [
      { id: 'r18', name: 'מאגר יועצי חירום 2018' },
      { id: 'r20', name: 'מאגר יועצי חירום 2020' },
    ],
    fields: [
      { id: 'f1', source_text: 'כתיבת תיק אב; כתיבת נהלי אבטחה' },
      { id: 'f2', source_text: "א'2 מוכנות לחרום" },
      { id: 'f3', source_text: "ב'1 חרום מזרח העיר" },
    ],
    documents: [{ id: 'd', url: 'https://example.test/doc' }],
    audit: null,
    ...overrides,
  } as unknown as SupplierDetail;
}

describe('supplier header', () => {
  it('lists other names once, ignoring quotes, spaces and the company suffix', () => {
    const data = detail();
    assert.deepEqual(alsoKnownAs(data.supplier.display_name, data.names), ['ישראטים']);
  });
  it('summarizes kind, identifier, city and registries, skipping what is missing', () => {
    assert.deepEqual(summaryParts(detail()), [
      'חברה',
      'ח.פ. 512679903',
      'הרצליה',
      'רשום ב-2 מאגרים',
    ]);
    assert.deepEqual(summaryParts(detail({ identifiers: [], contacts: [], memberships: [] })), [
      'חברה',
    ]);
    assert.equal(cityOf('רחוב בלי עיר'), null);
  });
  it('separates activity from verification and explains what is not verified', () => {
    assert.deepEqual(
      headerBadges(detail().supplier).map((badge) => badge.text),
      ['פעיל'],
    );
    assert.deepEqual(verificationMark(detail().supplier), {
      verified: false,
      label: 'ממתין לאימות',
    });
    const verified = { ...detail().supplier, review_status: 'verified' };
    assert.deepEqual(verificationMark(verified), { verified: true, label: 'ספק מאומת' });
    assert.match(verificationNote(detail()) ?? '', /עדיין לא אומתו/);
    assert.match(verificationNote(detail({ identifiers: [] })) ?? '', /אין לספק מספר מזהה/);
  });
});

describe('registry listings', () => {
  it('merges a version into one listing, splits ";" fields and marks expired ones', () => {
    const [first, second] = listings(detail(), TODAY);
    assert.ok(first && second);
    assert.equal(first.registry, 'מאגר יועצי חירום 2020');
    assert.deepEqual(first.fields, ["א'2 מוכנות לחרום", "ב'1 חרום מזרח העיר"]);
    assert.equal(first.validity, 'תוקף הרישום: לא ידוע');
    assert.equal('source' in first, false);
    assert.deepEqual(second.fields, ['כתיבת תיק אב', 'כתיבת נהלי אבטחה']);
    assert.equal(second.badge.text, 'פג תוקף');
    assert.equal(second.validity, 'תוקף הרישום פג ב-31.12.2020');
  });
});

describe('contact links', () => {
  it('opens mail, phone, maps and https sites, and nothing for odd values', () => {
    assert.equal(contactLink('email', 'a@b.co.il'), 'mailto:a@b.co.il');
    assert.equal(contactLink('email', 'not mail'), null);
    assert.equal(contactLink('phone', '02-123 4567'), 'tel:021234567');
    assert.match(
      contactLink('address', 'יפו 1, ירושלים') ?? '',
      /^https:\/\/www\.google\.com\/maps/,
    );
    assert.equal(contactLink('website', 'example.co.il'), 'https://example.co.il/');
    assert.equal(contactLink('contact_person', 'דנה'), null);
  });
});

describe('change history', () => {
  const at = '2026-11-17T07:37:34.120Z';
  let id = 0;
  const entry = (table_name: string, operation: string, created_at = at) => ({
    id: ++id,
    table_name,
    operation,
    row_id: String(id),
    changes: { display_name: { old: 'א', new: 'ב' } },
    created_at,
  });
  it('writes one plain sentence per load, without values', () => {
    assert.equal(
      sentence([entry('supplier_names', 'INSERT'), entry('supplier_names', 'INSERT')]),
      'נוספו 2 שמות',
    );
    assert.equal(sentence([entry('suppliers', 'INSERT')]), 'הספק נוצר במערכת');
    assert.equal(sentence([entry('suppliers', 'UPDATE')]), 'עודכנו פרטי הספק: שם');
    assert.equal(sentence([entry('supplier_contacts', 'DELETE')]), 'הוסר פרט קשר');
  });
  it('groups by Jerusalem day and merges changes made in the same second', () => {
    const days = historyDays([
      entry('memberships', 'INSERT', '2026-11-17T20:56:09Z'),
      entry('supplier_names', 'INSERT'),
      entry('supplier_names', 'INSERT', '2026-11-17T07:37:34.900Z'),
      entry('suppliers', 'INSERT', '2026-11-16T22:30:00Z'),
    ]);
    assert.deepEqual(
      days.map((day) => [day.date, day.lines.map((line) => `${line.time} ${line.text}`)]),
      [['17.11.2026', ['22:56 נוסף רישום במאגר', '09:37 נוספו 2 שמות', '00:30 הספק נוצר במערכת']]],
    );
  });
});

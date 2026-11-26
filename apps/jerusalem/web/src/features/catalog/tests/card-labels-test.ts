import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { venueFacts, inactiveLine, supplierFields } from '../model/card-labels.ts';
import type { Membership } from '../../../catalog-model.ts';

it('explains why a supplier is inactive', () => {
  const inactive = { reason: 'מונתה לשופטת', source: 'פרסום', changedOn: '2026-09-01' };
  assert.equal(inactiveLine(inactive), 'סיבה: מונתה לשופטת · מקור: פרסום · מתאריך 2026-09-01');
});

describe('supplier fields on the card', () => {
  const listing = (field: string, validUntil: string | null) =>
    ({ registry: 'מאגר יועצים', field, validFrom: null, validUntil }) as Membership;
  it('lists each current field once, using the registry when a listing has no field', () => {
    const rows = [listing('ניהול פרויקטים', null), listing('ניהול פרויקטים', '2027-01-01')];
    rows.push(listing('', null), listing('תכנון', '2020-01-01'));
    assert.deepEqual(supplierFields(rows, '2026-11-17'), ['ניהול פרויקטים', 'מאגר יועצים']);
  });
  it('splits a field the registry published as one ";" list into separate tags', () => {
    const rows = [listing("א'2 מוכנות לחרום; ב'1 חרום מזרח העיר", null)];
    rows.push(listing("ב'1 חרום מזרח העיר ;  ;כתיבת תיק אב", null));
    assert.deepEqual(supplierFields(rows, '2026-11-17'), [
      "א'2 מוכנות לחרום",
      "ב'1 חרום מזרח העיר",
      'כתיבת תיק אב',
    ]);
  });
  it('falls back to expired listings when nothing current is left', () => {
    assert.deepEqual(supplierFields([listing('תכנון', '2020-01-01')], '2026-11-17'), ['תכנון']);
  });
});

describe('venue facts', () => {
  it('labels each published detail in words and skips empty ones', () => {
    const venue = {
      capacity: 360,
      capacity_text: '360 מקומות ישיבה',
      hall_size: '35X25',
      stage_size: null,
      screen: 'אין',
      sound: '',
      lighting: null,
      survey_year: 2018,
    };
    assert.deepEqual(
      venueFacts(venue).map((fact) => fact.text),
      ['קיבולת: 360 מקומות ישיבה', 'גודל אולם: 35X25', 'מסך: אין', 'לפי מאגר 2018'],
    );
    assert.deepEqual(venueFacts(null), []);
  });

  it('writes reversed thousands the right way round', () => {
    const venue = {
      capacity: 11014,
      capacity_text: '014,11 מקומות',
      hall_size: null,
      stage_size: null,
      screen: null,
      sound: null,
      lighting: null,
      survey_year: 2024,
    };
    assert.deepEqual(
      venueFacts(venue).map((fact) => fact.text),
      ['קיבולת: 11,014 מקומות', 'לפי מאגר 2024'],
    );
  });

  it('shows nothing when the registry published only the year', () => {
    const venue = {
      capacity: null,
      capacity_text: null,
      hall_size: null,
      stage_size: null,
      screen: null,
      sound: null,
      lighting: null,
      survey_year: 2021,
    };
    assert.deepEqual(venueFacts(venue), []);
  });
});

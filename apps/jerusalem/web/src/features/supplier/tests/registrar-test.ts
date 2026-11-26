// Stage B (25.11): registrar answers in the verdict band, never "clean".
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { registrarRows } from '../model/registrar.ts';

const TODAY = '2026-11-25';

function withNumber(more: Record<string, unknown>, scheme = 'company'): SupplierDetail {
  return {
    identifiers: [
      { id: 'i', scheme, value: '512345678', review_status: 'verified', checked_at: null, ...more },
    ],
  } as unknown as SupplierDetail;
}

const titles = (data: SupplierDetail) => registrarRows(data, TODAY).map((r) => [r.state, r.title]);

describe('registrar rows', () => {
  it('says nothing was checked when no number was asked', () => {
    assert.deepEqual(titles(withNumber({})), [['none', 'לא נבדק ברשמים']]);
  });

  it('lists where no flag was found and what was not checked', () => {
    const rows = registrarRows(
      withNumber({
        checked_at: '2026-11-25T10:00:00Z',
        registrar_status: 'פעילה',
        registry_details: {
          'שנה אחרונה של דוח שנתי (שהוגש)': '2025',
          'אירועים ב-12 החודשים האחרונים': 'סילוק שעבוד 22.11.2026',
          checks: { registrar: 'ok', events: 'failed' },
        },
      }),
      TODAY,
    );
    assert.deepEqual(rows, [
      {
        state: 'ok',
        title: 'לא נמצא סימון ברשמים',
        detail: 'נבדק ב: רשם החברות. לא נבדק: אירועים ברשם',
      },
    ]);
  });

  it('flags an inactive body, a breach, a sub-status, a late report and recent events', () => {
    const data = withNumber({
      checked_at: '2026-11-25T10:00:00Z',
      registrar_status: 'בפירוק',
      registry_details: {
        מפרה: 'מפרה',
        'תת סטטוס': 'בהליכי מחיקה;צו לפתיחת הליכים',
        'שנה אחרונה של דוח שנתי (שהוגש)': '2021',
        'אירועים ב-12 החודשים האחרונים': 'רישום שעבוד 01.02.2026; סילוק שעבוד 01.03.2026',
        checks: { registrar: 'ok', events: 'ok' },
      },
    });
    const rows = registrarRows(data, TODAY);
    assert.deepEqual(
      rows.map((r) => [r.state, r.title]),
      [
        ['bad', 'הרשם מסר שהגוף לא פעיל'],
        ['warn', 'מסומנת כחברה מפרה'],
        ['warn', 'תת סטטוס ברשם'],
        ['warn', 'הדוח השנתי לא הוגש בזמן'],
        ['warn', 'אירועים ברשם בשנה האחרונה'],
      ],
    );
    assert.equal(rows[2]?.detail, 'בהליכי מחיקה, צו לפתיחת הליכים');
    assert.equal(rows[4]?.detail, 'רישום שעבוד 01.02.2026');
  });

  it('shows an unknown status and a missing certificate as they came, with what was missed', () => {
    const data = withNumber(
      {
        checked_at: '2026-11-25T10:00:00Z',
        registrar_status: 'בהקפאה',
        registry_details: {
          'ניהול תקין': 'אין רשומה לשנת 2026',
          checks: { guidestar: 'not_configured', amutot: 'ok', proper: 'ok', events: 'ok' },
        },
      },
      'nonprofit',
    );
    assert.deepEqual(titles(data), [
      ['warn', 'סטטוס לא רגיל ברשם'],
      ['warn', 'אין אישור ניהול תקין לשנה הזו'],
      ['none', 'לא נבדק'],
    ]);
    assert.equal(registrarRows(data, TODAY)[2]?.detail, 'גיידסטאר');
  });
});

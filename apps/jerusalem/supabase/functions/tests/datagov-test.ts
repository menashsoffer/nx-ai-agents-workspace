// Stage B registrar checks (25.11): field names as data.gov.il published them on 25.11.2026.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  AMUTOT,
  EVENTS,
  PROPER,
  checkDatagov,
  eventsText,
  isoDay,
  properText,
} from '../supplier-change-check/datagov.ts';

const NOW = new Date('2026-11-25T10:00:00Z');
const NONPROFIT = { id: 'n', scheme: 'nonprofit' as const, value: '580001980' };
const COMPANY = { id: 'c', scheme: 'company' as const, value: '514225044' };
const ok = (records: unknown[]) => Response.json({ success: true, result: { records } });

function fetcherFor(answers: Record<string, () => Response>) {
  const urls: URL[] = [];
  const fetcher: typeof fetch = (target) => {
    const url = new URL(target instanceof Request ? target.url : target.toString());
    urls.push(url);
    const id = url.searchParams.get('resource_id') ?? '';
    const make = Object.entries(answers).find(([base]) => base.endsWith(id))?.[1];
    return Promise.resolve(make ? make() : new Response('', { status: 500 }));
  };
  return { urls, fetcher };
}

describe('data.gov.il registrar checks', () => {
  it('reads dates, certificates and recent events', () => {
    assert.equal(isoDay('5/1/2026'), '2026-01-05');
    assert.equal(isoDay('Nov  3 2019'), null);
    assert.equal(properText([], 2026), 'אין רשומה לשנת 2026');
    assert.equal(properText([{ 'האם יש אישור': 'נחתם אישור' }], 2026), 'נחתם אישור (2026)');
    assert.equal(
      properText([{ 'האם יש אישור': 'נחתם אישור' }, { 'האם יש אישור': 'בטיפול' }], 2026),
      'לא ברור: נחתם אישור / בטיפול',
    );
    const events = [
      { 'סוג בקשה': 'רישום שעבוד', 'תאריך עדכון סטטוס': '01/02/2026' },
      { 'סוג בקשה': 'צו פירוק', 'תאריך עדכון סטטוס': '20/11/2026' },
      { 'סוג בקשה': 'ישן', 'תאריך עדכון סטטוס': '01/01/2024' },
    ];
    assert.equal(eventsText(events, '2025-11-25'), 'צו פירוק 20.11.2026; רישום שעבוד 01.02.2026');
  });

  it('checks a nonprofit in the registrar and for this year’s certificate', async () => {
    const { urls, fetcher } = fetcherFor({
      [AMUTOT]: () =>
        ok([{ 'מספר עמותה': 580001980, 'שם עמותה בעברית': 'אגודה (ע~ר)', 'סטטוס עמותה': 'רשומה' }]),
      [PROPER]: () => ok([{ 'האם יש אישור': 'נחתם אישור' }]),
      [EVENTS]: () => ok([]),
    });
    const [extra] = await checkDatagov([NONPROFIT], fetcher, NOW);
    assert.deepEqual(extra, {
      id: 'n',
      checks: { amutot: 'ok', proper: 'ok', events: 'ok' },
      details: { 'ניהול תקין': 'נחתם אישור (2026)' },
      nonprofit: { found: true, name: 'אגודה (ע"ר)', status: 'רשומה' },
    });
    const proper = urls.find((u) => PROPER.endsWith(u.searchParams.get('resource_id') ?? '-'));
    assert.equal(
      proper?.searchParams.get('filters'),
      '{"מספר עמותה":"580001980","שנת האישור":2026}',
    );
  });

  it('marks a lookup that failed instead of hiding it', async () => {
    const { fetcher } = fetcherFor({
      [EVENTS]: () => ok([{ 'סוג בקשה': 'רישום שעבוד', 'תאריך עדכון סטטוס': '22/11/2026' }]),
    });
    const [company, nonprofit] = await checkDatagov([COMPANY, NONPROFIT], fetcher, NOW);
    assert.deepEqual(company, {
      id: 'c',
      checks: { events: 'ok' },
      details: { 'אירועים ב-12 החודשים האחרונים': 'רישום שעבוד 22.11.2026' },
    });
    assert.deepEqual(nonprofit?.checks, { amutot: 'failed', proper: 'failed', events: 'ok' });
    assert.equal(nonprofit.nonprofit, undefined);
  });
});

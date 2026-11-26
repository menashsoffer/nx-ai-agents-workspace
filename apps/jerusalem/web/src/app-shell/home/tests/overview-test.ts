import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ADMIN_SCREENS } from '../../screens.ts';
import { dateLabel } from '../../../lib/dates.ts';
import { waitingItems, waitingLead, type HomeOverview } from '../model/overview.ts';

const OVERVIEW: HomeOverview = {
  active_suppliers: 1276,
  registries: 49,
  memberships: 2798,
  memberships_verified: 0,
  suppliers_identified: 473,
  my_open_requests: 0,
  lapsed: [{ registry_id: 'r1', name: 'פיתוח המשאב האנושי', count: 66, ended_on: '2026-11-07' }],
  kind_suggestions_pending: 297,
  registries_without_unit: 23,
};

describe('what waits on the home screen', () => {
  it('lists lapsed registrations first, then approvals, then gaps', () => {
    const items = waitingItems(OVERVIEW, ADMIN_SCREENS, { identifiers_pending: 377 });
    assert.deepEqual(
      items.map((i) => [i.tone, i.title]),
      [
        ['danger', '66 ספקים במאגר "פיתוח המשאב האנושי"'],
        ['warning', 'מועמדי מזהה ספק: 377 מועמדים ממתינים'],
        ['warning', '297 הצעות לסוג ישות'],
        ['info', '23 מאגרים בלי יחידה אחראית'],
      ],
    );
    assert.match(items[0]?.detail ?? '', /07\.11\.2026/);
    assert.deepEqual(items[0]?.linkState, { registry: 'r1', validity: 'expired' });
  });

  it('leaves out screens with nothing waiting and works without the overview', () => {
    const counts = { identifiers_pending: 1, categories_pending: 0 };
    const items = waitingItems(null, ADMIN_SCREENS, counts);
    assert.deepEqual(
      items.map((i) => i.title),
      ['מועמדי מזהה ספק: מועמד ממתין אחד'],
    );
    const quiet = { ...OVERVIEW, lapsed: [], kind_suggestions_pending: 0 };
    assert.deepEqual(waitingItems({ ...quiet, registries_without_unit: 0 }, [], {}), []);
  });

  it('asks to choose a winner when offers are open (stage C)', () => {
    const one = waitingItems({ ...OVERVIEW, lapsed: [], requests_to_award: 1 }, [], {});
    assert.equal(one.find((i) => i.id === 'award')?.title, 'בקשה אחת מחכה לבחירת זוכה');
    const many = waitingItems({ ...OVERVIEW, lapsed: [], requests_to_award: 3 }, [], {});
    assert.equal(many.find((i) => i.id === 'award')?.to, '/engagement');
  });

  it('shows dates the Israeli way', () => {
    assert.equal(dateLabel('2026-12-24'), '24.12.2026');
  });
});

describe('the line under the greeting', () => {
  const item = (tone: 'danger' | 'warning' | 'info') =>
    ({ id: tone, tone, badge: '', title: '', detail: '', action: '', to: '/' }) as const;
  it('says how much waits and how much of it is urgent', () => {
    assert.equal(waitingLead([]), 'אין כרגע עבודה שמחכה לך.');
    assert.equal(waitingLead([item('danger')]), 'יש נושא אחד פתוח, והוא דחוף.');
    assert.equal(waitingLead([item('info')]), 'יש נושא אחד פתוח.');
    assert.equal(
      waitingLead([item('info'), item('warning')]),
      'יש 2 נושאים פתוחים. שום דבר לא דחוף.',
    );
    assert.equal(
      waitingLead([item('danger'), item('danger'), item('info')]),
      'יש 3 נושאים פתוחים, 2 מהם דחופים.',
    );
    assert.equal(waitingLead([item('danger'), item('info')]), 'יש 2 נושאים פתוחים, אחד מהם דחוף.');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { days, inviteAge, inviteMessage, type Invite } from '../model/invite-age.ts';

const INVITE: Invite = {
  id: 'i1',
  email: 'office@example.co.il',
  created_at: '2026-11-19T09:00:00Z',
  expires_at: '2026-12-03T09:00:00Z',
  accepted_at: null,
};
const at = (iso: string) => inviteAge(INVITE, new Date(iso));

describe('how long an invite has been out', () => {
  it('counts days in Hebrew', () => {
    assert.deepEqual([days(1), days(2), days(5)], ['יום אחד', 'יומיים', '5 ימים']);
  });

  it('says how long ago it was sent and how long it still lasts', () => {
    assert.deepEqual(at('2026-11-22T10:00:00Z'), {
      state: 'open',
      sent: 'נשלחה ב-19.11.2026, לפני 3 ימים',
      status: 'בתוקף: נשארו עוד 10 ימים, עד 03.12.2026',
      elapsed: 3,
      length: 14,
    });
  });

  it('handles a fresh invite and the last days', () => {
    const fresh = at('2026-11-19T10:00:00Z');
    assert.match(fresh.sent, /לפני פחות מיום/);
    assert.match(fresh.status, /נשארו עוד 13 ימים/);
    assert.match(at('2026-12-02T08:00:00Z').status, /נשאר עוד יום אחד/);
    assert.match(at('2026-12-03T08:00:00Z').status, /פג בעוד פחות מיום/);
  });

  it('marks an expired and an accepted invite', () => {
    const late = at('2026-12-10T09:00:00Z');
    assert.equal(late.state, 'expired');
    assert.equal(late.elapsed, 14);
    assert.equal(late.status, 'פג תוקף ב-03.12.2026');
    assert.match(late.sent, /לפני 21 ימים/);
    const used = inviteAge({ ...INVITE, accepted_at: '2026-11-20T09:00:00Z' }, new Date());
    assert.equal(used.state, 'accepted');
    assert.equal(used.status, 'התקבלה ב-20.11.2026');
  });

  it('writes a message with the link, the email and the end date', () => {
    assert.equal(
      inviteMessage(INVITE, 'https://x.test/#/supplier-area'),
      'שלום,\nהוזמנתם לאזור האישי של הספקים בעיריית ירושלים.\n' +
        'היכנסו בקישור https://x.test/#/supplier-area עם הדוא"ל office@example.co.il.\n' +
        'ההזמנה בתוקף עד 03.12.2026.',
    );
  });
});

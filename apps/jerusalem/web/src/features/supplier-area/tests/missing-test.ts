import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Proposal, SupplierFile } from '../api/portal.ts';
import { dayOf } from '../../../lib/dates.ts';
import { missingTasks, orderedMemberships } from '../model/missing.ts';
import { plusDays } from '../model/portal-model.ts';

const TODAY = '2026-11-22';
type Membership = SupplierFile['memberships'][number];
const membership = (registry: string, until: string | null): Membership => ({
  registry,
  unit: null,
  field: null,
  registered_from: null,
  registered_until: until,
  document_url: null,
});
const file = (over: Partial<SupplierFile> = {}): SupplierFile => ({
  id: 's1',
  name: 'ספק',
  entity_kind: 'company',
  website: null,
  role: 'owner',
  other_names: [],
  identifiers: [],
  contacts: [
    { id: 'c1', kind: 'phone', value: '02-6291111' },
    { id: 'c2', kind: 'email', value: 'a@b.co.il' },
  ],
  memberships: [],
  ...over,
});
const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 'p',
  kind: 'contact',
  contact_kind: 'phone',
  old_value: null,
  new_value: '02-6290000',
  status: 'pending',
  decision_note: null,
  created_at: '2026-11-20T08:00:00Z',
  decided_at: null,
  mine: true,
  ...over,
});
const tasksOf = (f: SupplierFile, p: Proposal[], today: string) =>
  missingTasks({ file: f, proposals: p, documents: [] }, today);
const keys = (f: SupplierFile, p: Proposal[] = []) => tasksOf(f, p, TODAY).map((t) => t.key);

describe('what the supplier is missing', () => {
  it('shows nothing when every detail is in place', () => {
    assert.deepEqual(tasksOf(file(), [], TODAY), []);
  });

  it('counts registrations that end within 60 days, with the first end date', () => {
    const one = tasksOf(file({ memberships: [membership('א', '2026-12-31')] }), [], TODAY);
    assert.deepEqual(one, [
      {
        key: 'ending',
        text: `רישום אחד מסתיים ב-${dayOf('2026-12-31')}`,
        target: 'registries-title',
      },
    ]);
    const memberships = [
      membership('א', '2027-01-10'),
      membership('ב', '2026-12-01'),
      membership('ג', '2028-01-01'),
      membership('ד', '2025-01-01'),
    ];
    const [two] = tasksOf(file({ memberships }), [], TODAY);
    assert.equal(two?.text, `2 רישומים מסתיימים בחודשיים הקרובים, הראשון ב-${dayOf('2026-12-01')}`);
  });

  it('names a missing phone, a missing email, or both', () => {
    const text = (kinds: string[]) =>
      tasksOf(
        file({ contacts: kinds.map((kind, i) => ({ id: `c${String(i)}`, kind, value: 'x' })) }),
        [],
        TODAY,
      )[0]?.text;
    assert.equal(text(['email']), 'חסר טלפון ליצירת קשר');
    assert.equal(text(['phone']), 'חסר דוא"ל ליצירת קשר');
    assert.equal(text(['website']), 'חסרים טלפון ודוא"ל ליצירת קשר');
  });

  it('tells of fixes rejected in the last 30 days and of fixes still waiting', () => {
    const rejected = (day: string) =>
      proposal({ status: 'rejected', decided_at: `${day}T09:00:00Z` });
    assert.deepEqual(keys(file(), [rejected('2026-10-23')]), ['rejected']);
    assert.deepEqual(keys(file(), [rejected('2026-10-22')]), []);
    const tasks = tasksOf(file(), [rejected('2026-11-01'), rejected('2026-11-02')], TODAY);
    assert.equal(tasks[0]?.text, '2 בקשות נדחו');
    assert.equal(tasksOf(file(), [proposal({})], TODAY)[0]?.text, 'תיקון אחד ממתין לבדיקת העירייה');
    const two = tasksOf(file(), [proposal({}), proposal({ id: 'q' })], TODAY);
    assert.deepEqual(two, [
      { key: 'pending', text: '2 תיקונים ממתינים לבדיקת העירייה', target: 'requests-title' },
    ]);
  });

  it('keeps the three most urgent cards', () => {
    const busy = file({ contacts: [], memberships: [membership('א', '2026-12-01')] });
    const proposals = [proposal({ status: 'rejected', decided_at: '2026-11-21' }), proposal({})];
    assert.deepEqual(keys(busy, proposals), ['ending', 'rejected', 'contact']);
  });
});

describe('the order of my registrations', () => {
  it('puts the ones ending soon first and the ended ones last, otherwise as received', () => {
    const list = [
      membership('ended', '2025-01-01'),
      membership('valid', '2028-01-01'),
      membership('open', null),
      membership('soon', '2026-12-01'),
    ];
    const order = orderedMemberships(list, TODAY).map((m) => m.registry);
    assert.deepEqual(order, ['soon', 'valid', 'open', 'ended']);
  });

  it('adds calendar days across a month end', () => {
    assert.equal(plusDays('2026-11-22', 10), '2026-12-02');
    assert.equal(plusDays('2026-11-22', -30), '2026-10-23');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortlistCsv } from '../model/csv.ts';
import { readDraft } from '../model/draft.ts';
import {
  approachLabel,
  bccLine,
  bccMessage,
  shareLink,
  type PickedSupplier,
} from '../model/engagement.ts';
import { checkInputSchema } from '../model/result.ts';
import { cleanIds, SHORTLIST_MAX } from '../../../lib/shortlist.ts';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
function picked(over: Partial<PickedSupplier>): PickedSupplier {
  return {
    id: A,
    name: 'א',
    inactive: false,
    emails: [],
    phones: [],
    lastApproached: null,
    ...over,
  };
}
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('engagement request', () => {
  it('joins one address per active supplier with ; and names who has none', () => {
    const line = bccLine([
      picked({ name: 'א', emails: ['a@x.test', 'a2@x.test'] }),
      picked({ id: B, name: 'ב' }),
      picked({ name: 'ג', emails: ['c@x.test'], inactive: true }),
      picked({ name: 'ד', emails: ['d@x.test'] }),
    ]);
    assert.equal(line.text, 'a@x.test;d@x.test');
    assert.deepEqual(line.missing, ['ב']);
    assert.match(bccMessage(line), /הועתקו 2 .* עבור: ב\./u);
  });

  it('exports UTF-8 CSV with a BOM, quotes and no formulas', () => {
    const csv = shortlistCsv([picked({ name: '=HYPERLINK("x")', phones: ['02-1', '03-2'] })]);
    assert.ok(csv.startsWith('﻿שם הספק,'));
    assert.match(csv, /\r\n"'=HYPERLINK\(""x""\)",,02-1; 03-2,,פעיל\r\n$/u);
  });

  it('shares a hash-route link that lists only supplier ids', () => {
    const page = 'https://site.test/app/index.html#/catalog?q=x';
    const link = new URL(shareLink(page, [picked({}), picked({ id: B })]));
    assert.equal(link.pathname, '/app/index.html');
    const route = new URL(link.hash.slice(1), 'https://route.test');
    assert.equal(route.pathname, '/engagement');
    assert.equal(route.searchParams.get('suppliers'), `${A},${B}`);
  });

  it('keeps valid distinct ids up to the limit', () => {
    const many = Array.from(
      { length: 60 },
      (_, i) => `${A.slice(0, -2)}${String(i).padStart(2, '0')}`,
    );
    assert.deepEqual(cleanIds([A, A.toUpperCase(), 'x', 3, B]), [A, B]);
    assert.equal(cleanIds(many).length, SHORTLIST_MAX);
  });

  it('reads the draft and refuses what the database would refuse', () => {
    const draft = readDraft(form({ estimated_value: '120,000', value_includes_vat: 'on' }));
    assert.deepEqual(draft, {
      draft: { estimated_value: 120000, value_includes_vat: true, requested_exemption: null },
      unitId: '',
      subject: '',
    });
    assert.equal(typeof readDraft(form({ estimated_value: '-1' })), 'string');
    assert.equal(
      typeof readDraft(form({ estimated_value: '1', requested_exemption: '8' })),
      'string',
    );
    assert.equal(
      typeof readDraft(form({ estimated_value: '1', unit_id: 'u', subject: 'א' })),
      'string',
    );
    assert.ok(
      checkInputSchema.safeParse({
        draft: { estimated_value: 1, value_includes_vat: false, requested_exemption: '3(29א)' },
        on: '2026-11-17',
      }).success,
    );
  });

  it('says when a supplier was last approached', () => {
    assert.equal(approachLabel('2026-11-17'), 'פנייה אחרונה: 17.11.2026');
    assert.equal(approachLabel(null), 'לא נרשמה פנייה קודמת');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentList, SupplierDocument } from '../api/documents.ts';
import { dayOf } from '../../../lib/dates.ts';
import {
  documentRows,
  documentsTaskText,
  rowText,
  untilProblem,
  type KindRow,
} from '../model/documents.ts';
import { missingTasks } from '../model/missing.ts';
import type { SupplierFile } from '../api/portal.ts';

const TODAY = '2026-11-22';
const doc = (over: Partial<SupplierDocument>): SupplierDocument => ({
  id: 'd',
  kind: 'insurance',
  status: 'approved',
  valid_until: '2027-06-30',
  review_note: null,
  created_at: '2026-11-01T08:00:00Z',
  reviewed_at: '2026-11-02T08:00:00Z',
  storage_path: 's1/d.pdf',
  ...over,
});
const list = (documents: SupplierDocument[]): DocumentList => ({
  kinds: ['bookkeeping', 'tax_withholding', 'insurance'],
  documents,
});
const at = (rows: KindRow[], index: number): KindRow => {
  const row = rows[index];
  if (!row) throw new Error(`no row ${String(index)}`);
  return row;
};
const states = (rows: KindRow[]) => rows.map((r) => [r.kind, r.state]);

describe('the state of each document kind', () => {
  it('is missing, valid, ending within 30 days, or expired by the approved document', () => {
    const rows = documentRows(
      list([
        doc({ kind: 'bookkeeping', valid_until: '2026-12-10' }),
        doc({ kind: 'tax_withholding', valid_until: '2026-11-01' }),
      ]),
      TODAY,
    );
    assert.deepEqual(states(rows), [
      ['bookkeeping', 'ending'],
      ['tax_withholding', 'expired'],
      ['insurance', 'missing'],
    ]);
    assert.equal(rowText(at(rows, 0)), `בתוקף עד ${dayOf('2026-12-10')}, כדאי להעלות חדש`);
    assert.equal(rowText(at(rows, 1)), `פג תוקף ב-${dayOf('2026-11-01')}`);
    assert.equal(rowText(at(rows, 2)), 'חסר');
  });

  it('shows a newer upload that waits or was rejected, over the approved one', () => {
    const approved = doc({ id: 'a' });
    const waiting = doc({ id: 'w', status: 'pending', created_at: '2026-11-20T08:00:00Z' });
    const pending = at(documentRows(list([waiting, approved]), TODAY), 2);
    assert.equal(pending.state, 'pending');
    assert.equal(pending.current?.id, 'a');
    const rejected = doc({ id: 'r', status: 'rejected', review_note: 'לא קריא' });
    const row = at(documentRows(list([rejected]), TODAY), 2);
    assert.equal(rowText(row), 'נדחה: לא קריא');
    assert.equal(rowText({ ...row, latest: undefined }), 'נדחה');
    const valid = at(documentRows(list([approved]), TODAY), 2);
    assert.equal(rowText(valid), `בתוקף עד ${dayOf('2027-06-30')}`);
    assert.equal(rowText(pending), 'בבדיקה');
  });

  it('accepts a valid-until date from today up to ten years ahead', () => {
    assert.equal(untilProblem('', TODAY), 'צריך לבחור תאריך תוקף.');
    assert.match(untilProblem('2026-11-21', TODAY) ?? '', /מהיום/);
    assert.match(untilProblem('2036-11-23', TODAY) ?? '', /מהיום/);
    assert.equal(untilProblem('2036-11-22', TODAY), null);
    assert.equal(untilProblem(TODAY, TODAY), null);
  });
});

describe('the documents card', () => {
  const rows = (documents: SupplierDocument[]) => documentRows(list(documents), TODAY);
  const complete = [
    doc({ kind: 'bookkeeping' }),
    doc({ kind: 'tax_withholding' }),
    doc({ kind: 'insurance' }),
  ];

  it('names the most urgent document first, then counts the rest', () => {
    const expired = doc({ kind: 'bookkeeping', valid_until: '2026-11-01' });
    const ending = doc({ kind: 'insurance', valid_until: '2026-12-01' });
    assert.equal(
      documentsTaskText(rows([ending, expired, doc({ kind: 'tax_withholding' })])),
      `אישור ניהול ספרים פג ב-${dayOf('2026-11-01')}, ועוד 1`,
    );
    assert.equal(
      documentsTaskText(rows([ending, ...complete.slice(0, 2)])),
      `אישור קיום ביטוחים מסתיים ב-${dayOf('2026-12-01')}`,
    );
    const rejected = doc({ kind: 'insurance', status: 'rejected', review_note: 'x' });
    assert.equal(
      documentsTaskText(rows([rejected, ...complete.slice(0, 2)])),
      'אישור קיום ביטוחים נדחה',
    );
  });

  it('counts missing documents, and is quiet when all are in order', () => {
    assert.equal(documentsTaskText(rows([])), 'חסרים 3 מסמכים');
    assert.equal(documentsTaskText(rows(complete.slice(0, 2))), 'חסר מסמך אחד');
    assert.equal(documentsTaskText(rows(complete)), null);
  });

  it('comes right after ending registrations in "מה חסר לי"', () => {
    const file = {
      contacts: [],
      memberships: [
        {
          registry: 'א',
          unit: null,
          field: null,
          registered_from: null,
          registered_until: '2026-12-01',
          document_url: null,
        },
      ],
    } as unknown as SupplierFile;
    const tasks = missingTasks({ file, proposals: [], documents: rows([]) }, TODAY);
    assert.deepEqual(
      tasks.map((t) => [t.key, t.target]),
      [
        ['ending', 'registries-title'],
        ['documents', 'documents-title'],
        ['contact', 'details-title'],
      ],
    );
  });
});

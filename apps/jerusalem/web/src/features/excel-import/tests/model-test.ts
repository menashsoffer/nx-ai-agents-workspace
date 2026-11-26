import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { autoMapping, isTemplate, normalizeHeader, FIELDS, HEADERS } from '../model/columns.ts';
import { matches, suggestion, summarize, type ReviewRow } from '../model/decisions.ts';
import { draftRows, freshRows } from '../model/flow.ts';
import { sha256, stagedRows, tableOf } from '../model/rows.ts';
import { editedRow, looksReversed } from '../model/values.ts';
import type { ImportRow } from '../api/import.ts';

describe('columns', () => {
  it('matches template headers and common variants once each', () => {
    assert.equal(normalizeHeader(' דוא"ל '), 'דואל');
    assert.deepEqual(autoMapping(['שם הספק', 'ח.פ.', 'מייל', 'שם', 'משהו']), [
      'name',
      'value',
      'email',
      null,
      null,
    ]);
    assert.equal(isTemplate(FIELDS.map((f) => HEADERS[f])), true);
    assert.equal(isTemplate(['שם ספק']), false);
  });
});

describe('row values', () => {
  it('keeps leading zeros and maps kinds and identifier types', () => {
    const { edited, issues } = editedRow({
      name: 'ספק',
      entity_kind: 'חל״צ',
      scheme: 'ח.פ.',
      value: '012-345678',
      phone: '+972 2-1234567',
      note: 'הערה',
    });
    assert.deepEqual(edited, {
      name: 'ספק',
      entity_kind: 'company',
      scheme: 'company',
      value: '012345678',
      phone: '+972 2-1234567',
    });
    assert.deepEqual(issues, []);
  });
  it('marks bad values and leaves them out without blocking the rest', () => {
    const { edited, issues } = editedRow({
      name: 'ספק',
      entity_kind: 'מוזר',
      value: '123',
      phone: '0528776563026261461',
      email: 'לא',
      website: 'www.a.co.il',
      address: 'םילשורי',
    });
    assert.deepEqual(edited, { name: 'ספק', address: 'םילשורי' });
    assert.deepEqual(
      issues.map((i) => i.field),
      ['entity_kind', 'value', 'phone', 'email', 'website', 'address'],
    );
    assert.equal(issues[2]?.text, 'נראה כמו שני מספרים מחוברים');
  });
  it('drops a number without its type, and asks for a name and a way to reach', () => {
    const one = editedRow({ name: 'א', value: '12345' });
    assert.equal(one.edited.value, undefined);
    assert.equal(one.issues[0]?.field, 'scheme');
    const two = editedRow({ scheme: 'ת.ז.', phone: '123' });
    assert.deepEqual(two.edited, {});
    assert.deepEqual(
      two.issues.map((i) => i.field),
      ['phone', 'name', 'value'],
    );
    assert.equal(
      editedRow({ name: 'א', entity_kind: 'לא ידוע', email: 'a@b.co' }).issues.length,
      0,
    );
    assert.equal(looksReversed('ןוח'), true);
    assert.equal(looksReversed('ירושלים'), false);
  });
});

describe('rows', () => {
  it('finds the header row, skips empty rows, and keeps unknown columns in raw', () => {
    const table = tableOf([[], ['שם ספק', '', 'אחר'], ['א', '', 'x'], ['', ''], ['ב']]);
    assert.deepEqual(table.headers, ['שם ספק', 'עמודה 2', 'אחר']);
    assert.deepEqual(
      table.rows.map((r) => r.number),
      [3, 5],
    );
    const [first] = stagedRows(table, ['name', null, null]);
    assert.deepEqual(first?.raw, { 'שם ספק': 'א', אחר: 'x' });
    assert.equal(first.edited.name, 'א');
    assert.deepEqual(tableOf([[''], []]), { headers: [], rows: [] });
  });
  it('hashes the file with SHA-256', async () => {
    assert.equal(
      await sha256(new TextEncoder().encode('abc')),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

const candidate = (id: string, rank: number) => ({ id, name: id, match_rank: rank });

describe('suggestions', () => {
  it('suggests new, link or review, and never link on a similar name alone', () => {
    assert.deepEqual(suggestion([], []), { decision: 'new' });
    assert.deepEqual(suggestion([candidate('a', 1)], []), { decision: 'link', target: 'a' });
    assert.deepEqual(suggestion([candidate('a', 4)], []), { decision: 'hold' });
    assert.deepEqual(suggestion([candidate('a', 1), candidate('b', 3)], []), { decision: 'hold' });
    assert.deepEqual(suggestion([], [{ field: 'name', text: 'x' }]), { decision: 'hold' });
  });
  it('counts decisions and filters rows', () => {
    const row: ReviewRow = {
      rowId: 1,
      rowNumber: 2,
      raw: {},
      edited: {},
      issues: [],
      candidates: [candidate('a', 3)],
      choice: { decision: 'hold' },
    };
    assert.deepEqual(summarize([row.choice, { decision: 'skip', note: 'x' }]), {
      new: 0,
      link: 0,
      hold: 1,
      skip: 1,
    });
    assert.deepEqual(
      (['all', 'issues', 'candidates', 'hold'] as const).map((f) => matches(row, f)),
      [true, false, true, true],
    );
  });
});

const saved = (over: Partial<ImportRow>): ImportRow => ({
  id: 7,
  row_number: 3,
  raw: { a: 'b' },
  edited: { name: 'א', phone: null },
  status: 'pending',
  decision: null,
  target_supplier_id: null,
  error: null,
  reviewer_note: null,
  ...over,
});

describe('review rows', () => {
  it('pairs staged rows with what was sent', () => {
    const sent = stagedRows(tableOf([['שם ספק'], ['א']]), ['name']);
    const rows = freshRows(
      { batch_id: 'b', duplicate: false, rows: [{ row_id: 9, candidates: [] }] },
      sent,
    );
    assert.equal(rows[0]?.rowId, 9);
    assert.equal(rows[0].rowNumber, 2);
    assert.deepEqual(rows[0].choice, { decision: 'new' });
    assert.deepEqual(freshRows({ batch_id: 'b', duplicate: false }, sent), []);
  });
  it('reopens pending rows with saved decisions and errors', () => {
    const staged = { batch_id: 'b', duplicate: true, rows: [{ row_id: 7, candidates: [] }] };
    const rows = draftRows(staged, [
      saved({ decision: 'link', target_supplier_id: 's', error: 'reason:import_name_invalid' }),
      saved({ id: 8, decision: 'new' }),
      saved({ id: 9, edited: null, error: 'reason:import_row_failed:23505' }),
      saved({ id: 10, status: 'promoted' }),
    ]);
    assert.deepEqual(
      rows.map((r) => r.choice),
      [{ decision: 'link', target: 's' }, { decision: 'new' }, { decision: 'hold' }],
    );
    assert.deepEqual(rows[0]?.edited, { name: 'א' });
    assert.match(rows[0].issues[0]?.text ?? '', /אין שם ספק/);
    assert.match(rows[2]?.issues[0]?.text ?? '', /קוד 23505/);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { writableVersions, type WriteContext } from '../../../data/write-context.ts';
import { access } from '../../../../tests/catalog-fixture.ts';
import { OFFERED_FIELD, fieldsOf, parseAddForm, versionLabel } from '../model/add-form.ts';
import { duplicates } from '../model/duplicates.ts';
import { changedFields, safeSourceUrl } from '../model/labels.ts';

const catalog = {
  suppliers: [
    { id: 'a', display_name: 'חברת אלון בעמ', status: 'active' },
    { id: 'b', display_name: 'ספק אחר', status: 'active' },
    { id: 'c', display_name: 'חברת אלון בעמ', status: 'inactive' },
  ],
  names: [{ supplier_id: 'a', name: 'אלון ייעוץ' }],
  memberships: [
    { supplier_id: 'b', registry_version_id: 'v2' },
    { supplier_id: 'b', registry_version_id: 'v2' },
    { supplier_id: 'b', registry_version_id: 'missing' },
  ],
  registries: [
    { id: 'r1', name: 'מאגר א', status: 'active', owner_unit_id: 'u1' },
    { id: 'r2', name: 'מאגר ב', status: 'active', owner_unit_id: 'u2' },
    { id: 'r3', name: 'מאגר ג', status: 'active', owner_unit_id: null },
  ],
  versions: [
    { id: 'v1', registry_id: 'r1', valid_from: null, valid_until: null },
    { id: 'v2', registry_id: 'r2', valid_from: null, valid_until: null },
    { id: 'v3', registry_id: 'r3', valid_from: null, valid_until: null },
  ],
  fields: [
    { id: 'f1', registry_id: 'r1', source_text: 'תכנון' },
    { id: 'f2', registry_id: 'r2', source_text: 'ניהול' },
    { id: 'f3', registry_id: 'r3', source_text: 'פיקוח' },
  ],
} as unknown as WriteContext['catalog'];
const context: WriteContext = {
  catalog,
  identifiers: [{ supplier_id: 'b', value: '512345678' }] as WriteContext['identifiers'],
  versions: writableVersions(catalog, access({ admin: true })),
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('duplicate suppliers', () => {
  it('finds similar names, former names and exact official numbers, active suppliers only', () => {
    assert.deepEqual(
      duplicates(context, 'חברת אלן בעמ', '').map((c) => c.id),
      ['a'],
    );
    assert.equal(duplicates(context, 'אלון ייעוץ', '')[0]?.id, 'a');
    const byNumber = duplicates(context, 'לא דומה', '512345678');
    assert.deepEqual(byNumber, [
      { id: 'b', name: 'ספק אחר', identifierMatch: true, registries: ['מאגר ב'] },
    ]);
    assert.deepEqual(duplicates(context, 'חברת אלון', '')[0]?.registries, []);
    assert.deepEqual(duplicates(context, '', ''), []);
  });
});

describe('writable pools', () => {
  it('offers editors only their unit and admins also unowned pools', () => {
    const editor = access({ editor: true, grants: [{ role: 'editor', unitId: 'u1' }] });
    assert.deepEqual(
      writableVersions(catalog, editor).map((row) => row.versionId),
      ['v1'],
    );
    assert.deepEqual(
      context.versions.map((row) => row.versionId),
      ['v1', 'v2', 'v3'],
    );
    assert.deepEqual(
      fieldsOf(context, 'v2').map((field) => field.id),
      ['f2'],
    );
    assert.deepEqual(fieldsOf(context, ''), []);
  });
});

describe('pool list in the add form', () => {
  const pools = {
    ...catalog,
    registries: [
      { id: 'r1', name: 'מאגר ת', status: 'active', owner_unit_id: null },
      { id: 'r2', name: 'מאגר א', status: 'unknown', owner_unit_id: null },
      { id: 'r3', name: 'מאגר ב', status: 'closed', owner_unit_id: null },
    ],
    versions: [
      {
        id: 'v1',
        registry_id: 'r1',
        source_document_id: 'd1',
        valid_from: null,
        valid_until: null,
      },
      {
        id: 'v2',
        registry_id: 'r2',
        source_document_id: null,
        valid_from: null,
        valid_until: null,
      },
      {
        id: 'v3',
        registry_id: 'r3',
        source_document_id: 'd3',
        valid_from: null,
        valid_until: null,
      },
    ],
  } as unknown as WriteContext['catalog'];

  it('offers pools of unknown status, never closed ones, sorted by name', () => {
    const rows = writableVersions(pools, access({ admin: true }));
    assert.deepEqual(
      rows.map((row) => [row.versionId, row.statusKnown]),
      [
        ['v2', false],
        ['v1', true],
      ],
    );
  });

  it('labels a pool by name, adding dates and a missing source only when they say something', () => {
    const [unknown, known] = writableVersions(pools, access({ admin: true }));
    assert.equal(known && versionLabel(known), 'מאגר ת');
    assert.equal(unknown && versionLabel(unknown), 'מאגר א · ללא מסמך מקור');
    const dated = { ...known, validFrom: '2025-01-01', validUntil: null } as typeof known;
    assert.equal(dated && versionLabel(dated), 'מאגר ת · 2025-01-01 – ללא סיום');
  });
});

describe('add-supplier form', () => {
  it('requires the identifier type and number together', () => {
    const half = parseAddForm(form({ display_name: 'ספק', identifier: '12345' }));
    assert.match(half.error, /גם סוג מזהה וגם מספר/);
    const both = parseAddForm(
      form({ display_name: ' ספק ', identifier_scheme: 'company', identifier: '512679903' }),
    );
    assert.equal(both.payload?.display_name, 'ספק');
  });

  it('names every field that breaks a shared rule', () => {
    const junk = parseAddForm(
      form({
        display_name: 'ספק',
        identifier_scheme: 'company',
        identifier: '512679904',
        phone: 'x',
      }),
    );
    assert.match(junk.error, /מספר מזהה: ספרת הביקורת/);
    assert.match(junk.error, /טלפון: מספר טלפון לא תקין/);
  });

  it('refuses an unanswered duplicate choice and links a chosen existing supplier', () => {
    const offered = { display_name: 'אלון', [OFFERED_FIELD]: '1' };
    assert.match(parseAddForm(form(offered)).error, /ספק קיים או יצירה חדשה/);
    assert.equal(
      parseAddForm(form({ ...offered, supplier_choice: 'a' })).payload?.supplier_id,
      'a',
    );
    const created = parseAddForm(form({ ...offered, supplier_choice: 'new' })).payload;
    assert.ok(created);
    assert.equal('supplier_id' in created, false);
    assert.equal(OFFERED_FIELD in created, false);
  });
});

describe('detail labels', () => {
  it('names changed fields without values', () => {
    const changes = { display_name: { old: 'א', new: 'ב' }, name: {}, secret: {} };
    assert.equal(changedFields(changes), 'שם');
    assert.equal(changedFields(null), '');
  });

  it('allows only https source links', () => {
    assert.equal(safeSourceUrl('https://example.test/a'), 'https://example.test/a');
    assert.equal(safeSourceUrl('javascript:alert(1)'), null);
    assert.equal(safeSourceUrl('not a url'), null);
  });
});

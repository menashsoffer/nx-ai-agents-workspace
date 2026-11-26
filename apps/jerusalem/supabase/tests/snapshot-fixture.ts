import type { PGlite } from '@electric-sql/pglite';

import { ACCESS_FIXTURE, REGISTRY, SUPPLIER, UNIT_2, VERSION } from './access-fixture.ts';

export const BEFORE_SNAPSHOT = '20261116021000_cleanup_duplicate_road_field.sql';
export const OTHER_SUPPLIER = '40000000-0000-0000-0000-000000000002';
export const OTHER_VERSION = '30000000-0000-0000-0000-000000000003';
export const DOCUMENT = '50000000-0000-0000-0000-000000000001';
export const FIELD = '60000000-0000-0000-0000-000000000001';

export async function snapshotFixture(db: PGlite): Promise<void> {
  await db.exec(ACCESS_FIXTURE);
  await db.exec(`
    insert into public.source_documents (id, url) values ('${DOCUMENT}', 'https://example.test/a');
    update public.registry_versions set source_document_id = '${DOCUMENT}' where id = '${VERSION}';
    insert into public.registries (id, name, owner_unit_id) values
      ('30000000-0000-0000-0000-000000000004', 'מאגר אחר', '${UNIT_2}'),
      ('30000000-0000-0000-0000-000000000005', 'ללא יחידה', null);
    insert into public.registry_versions (id, registry_id) values
      ('${OTHER_VERSION}', '30000000-0000-0000-0000-000000000004'),
      ('30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000005');
    insert into public.suppliers (id, display_name) values ('${OTHER_SUPPLIER}', 'ספק אחר');
    insert into public.suppliers (display_name, status, merged_into_id)
      values ('ממוזג', 'merged', '${SUPPLIER}');
    insert into public.registry_fields (id, registry_id, source_text)
      values ('${FIELD}', '${REGISTRY}', 'תחום בדיקה');
    insert into public.categories (id, name, active) values
      ('70000000-0000-0000-0000-000000000001', 'קטגוריה א', true),
      ('70000000-0000-0000-0000-000000000002', 'קטגוריה ב', true),
      ('70000000-0000-0000-0000-000000000003', 'קטגוריה לא פעילה', false);
    insert into public.registry_field_categories (registry_field_id, category_id) values
      ('${FIELD}', '70000000-0000-0000-0000-000000000001'),
      ('${FIELD}', '70000000-0000-0000-0000-000000000002');
    insert into public.supplier_names (supplier_id, name, source_document_id)
      values ('${SUPPLIER}', 'שם מקור', '${DOCUMENT}');
    insert into public.supplier_contacts (supplier_id, kind, value, status) values
      ('${SUPPLIER}', 'phone', '0501234567', 'current'),
      ('${SUPPLIER}', 'email', 'old@example.test', 'outdated'),
      ('${OTHER_SUPPLIER}', 'email', 'disputed@example.test', 'disputed');
    insert into public.memberships (supplier_id, registry_version_id, registry_field_id)
      values ('${SUPPLIER}', '${VERSION}', '${FIELD}');
    insert into public.memberships (supplier_id, registry_version_id, review_status)
      select '${OTHER_SUPPLIER}', id, 'verified' from public.registry_versions;
    insert into public.registry_fields (id, registry_id, source_text)
      select md5(status)::uuid, '${REGISTRY}', status
      from unnest(array['verified', 'rejected', 'removed']) status;
    insert into public.memberships (supplier_id, registry_version_id, registry_field_id,
      review_status) select '${SUPPLIER}', '${VERSION}', md5(status)::uuid, status
      from unnest(array['verified', 'rejected', 'removed']) status;
  `);
}

export const PROJECTIONS = {
  suppliers: ['id', 'display_name', 'entity_kind', 'status', 'website', 'review_status', 'note'],
  names: ['name', 'kind', 'source_document_id'],
  memberships: [
    'registry_version_id',
    'registry_field_id',
    'name_as_published',
    'source_page',
    'registered_from',
    'registered_until',
    'engagement_started_on',
    'dates_source',
    'review_status',
  ],
  registries: ['id', 'name', 'owner_unit_id', 'status'],
  versions: ['id', 'registry_id', 'source_document_id', 'valid_from', 'valid_until'],
  fields: ['id', 'registry_id', 'source_text'],
  categories: ['id', 'name', 'parent_id'],
  fieldCategories: ['registry_field_id', 'category_id'],
  units: ['id', 'name'],
  documents: ['id', 'url'],
} as const;

const TABLES = {
  suppliers: ['suppliers', "status <> 'merged'"],
  names: ['supplier_names', 'true'],
  memberships: ['memberships', "review_status not in ('rejected', 'removed')"],
  contacts: ['supplier_contacts', "status = 'current'"],
  registries: ['registries', 'true'],
  versions: ['registry_versions', 'true'],
  fields: ['registry_fields', 'true'],
  categories: ['categories', 'active'],
  fieldCategories: ['registry_field_categories', 'true'],
  units: ['org_units', 'true'],
  documents: ['source_documents', 'true'],
  identifiers: ['supplier_identifiers', "review_status <> 'rejected'"],
  candidates: ['identifier_candidates', "status = 'pending'"],
  venues: ['venue_specs', 'true'],
} as const;

type Records = Record<string, unknown>;
const DEFAULTS: Record<string, string> = {
  entity_kind: 'unknown',
  status: 'active',
  review_status: 'needs_review',
  kind: 'as_published',
  dates_source: 'unknown',
};
function compactValue(column: string, value: unknown, displayName: unknown): unknown {
  if (['name', 'name_as_published'].includes(column) && value === displayName) return 0;
  return DEFAULTS[column] === value ? null : value;
}

/** Columns that point at a sibling array, mapped to that array, as the snapshot encodes them. */
const POSITIONS: Record<string, keyof typeof TABLES> = {
  registry_version_id: 'versions',
  registry_field_id: 'fields',
  source_document_id: 'documents',
  registry_id: 'registries',
};
type Positions = Record<string, Map<unknown, number>>;
function encode(column: string, value: unknown, positions: Positions): unknown {
  const target = POSITIONS[column];
  if (!target || value === null) return value;
  return positions[target]?.get(value) ?? null;
}

function identifierState(tables: Record<string, Records[]>, supplier: unknown): string | null {
  const own = (tables.identifiers ?? []).filter((row) => row.supplier_id === supplier);
  if (own.some((row) => row.review_status === 'verified')) return 'verified';
  const candidate = (tables.candidates ?? []).some((row) => row.supplier_id === supplier);
  return own.length || candidate ? 'pending' : null;
}

const VENUE = ['capacity', 'capacity_text', 'hall_size', 'stage_size', 'screen', 'sound'];
function venueRow(tables: Record<string, Records[]>, supplier: unknown): unknown[] | null {
  const venue = (tables.venues ?? []).find((row) => row.supplier_id === supplier);
  return venue ? [...VENUE, 'lighting', 'survey_year'].map((col) => venue[col]) : null;
}

export async function directCatalog(db: PGlite): Promise<Records> {
  const tables: Record<string, Records[]> = {};
  for (const [key, [table, where]] of Object.entries(TABLES)) {
    const order =
      key === 'fieldCategories'
        ? 'registry_field_id, category_id'
        : key === 'venues'
          ? 'supplier_id'
          : 'id';
    tables[key] = (
      await db.query<Records>(`select * from public.${table} where ${where} order by ${order}`)
    ).rows;
  }
  const positions: Positions = Object.fromEntries(
    Object.values(POSITIONS).map((key) => [
      key,
      new Map((tables[key] ?? []).map((row, index) => [row.id, index])),
    ]),
  );
  const result: Records = {};
  for (const key of [
    'registries',
    'categories',
    'fieldCategories',
    'units',
    'documents',
  ] as const) {
    result[key] = (tables[key] ?? []).map((row) => PROJECTIONS[key].map((col) => row[col]));
  }
  for (const key of ['versions', 'fields'] as const) {
    result[key] = (tables[key] ?? []).map((row) =>
      PROJECTIONS[key].map((col) => (col === 'id' ? row[col] : encode(col, row[col], positions))),
    );
  }
  result.suppliers = (tables.suppliers ?? []).map((row) => [
    ...PROJECTIONS.suppliers.map((col) => compactValue(col, row[col], row.display_name)),
    ...(['names', 'memberships'] as const).map((key) =>
      (tables[key] ?? [])
        .filter((item) => item.supplier_id === row.id)
        .map((item) =>
          PROJECTIONS[key].map((col) =>
            encode(col, compactValue(col, item[col], row.display_name), positions),
          ),
        ),
    ),
    [
      ...new Set(
        (tables.contacts ?? []).filter((c) => c.supplier_id === row.id).map((c) => c.kind),
      ),
    ].sort(),
    identifierState(tables, row.id),
    row.status === 'inactive'
      ? [row.status_reason, row.status_source, row.status_changed_on]
      : null,
    venueRow(tables, row.id),
  ]);
  return result;
}

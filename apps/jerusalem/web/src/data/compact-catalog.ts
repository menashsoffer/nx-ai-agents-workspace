import type { CatalogData, IdentifierState, Venue } from './catalog.ts';
import { array, nullable, number, object, rows, text, tuple } from './parse.ts';
import { DataError } from './client.ts';

const optionalText = nullable(text);
const position = nullable(number);
const defaults =
  (fallback: string) =>
  (value: unknown): string =>
    value === null ? fallback : text(value);
const NAME = { name: text, kind: defaults('as_published'), document: position };
const MEMBER = {
  version: position,
  field: position,
  name_as_published: optionalText,
  source_page: nullable(number),
  registered_from: optionalText,
  registered_until: optionalText,
  engagement_started_on: optionalText,
  dates_source: defaults('unknown'),
  review_status: defaults('needs_review'),
};
const SUPPLIER = {
  id: text,
  display_name: text,
  entity_kind: defaults('unknown'),
  status: defaults('active'),
  website: optionalText,
  review_status: defaults('needs_review'),
  note: optionalText,
};

/** A nested row names a sibling array entry by its position; resolve it back to an id. */
function idAt(list: { id: string }[], at: number | null): string | null {
  if (at === null) return null;
  const row = list[at];
  if (!row) throw new DataError(0);
  return row.id;
}

function inheritedName(value: unknown, index: number, name: string): unknown[] {
  const values = [...array(value)];
  if (values[index] === 0) values[index] = name;
  return values;
}

function identifierState(value: unknown): IdentifierState {
  if (value === null || value === 'verified' || value === 'pending') return value;
  throw new DataError(0);
}

/** Column 11 is `[reason, source, changedOn]` for an inactive supplier and null otherwise. */
function inactive(value: unknown) {
  if (value === null) return { status_reason: null, status_source: null, status_changed_on: null };
  const [reason, source, changedOn] = array(value);
  return {
    status_reason: optionalText(reason),
    status_source: optionalText(source),
    status_changed_on: optionalText(changedOn),
  };
}

const VENUE = {
  capacity: position,
  capacity_text: optionalText,
  hall_size: optionalText,
  stage_size: optionalText,
  screen: optionalText,
  sound: optionalText,
  lighting: optionalText,
  survey_year: position,
};

/** Column 12 is the venue's details in the order of VENUE, or null for other suppliers. */
function venue(value: unknown): Venue | null {
  return value === null ? null : tuple(array(value), VENUE);
}

function supplier(value: unknown, result: CatalogData): void {
  const raw = array(value);
  if (raw.length !== 13) throw new DataError(0);
  const row = {
    ...tuple(raw.slice(0, 7), SUPPLIER),
    identifier_state: identifierState(raw[10]),
    ...inactive(raw[11]),
    venue: venue(raw[12]),
  };
  result.suppliers.push(row);
  const names = array(raw[7]).map((value) => inheritedName(value, 0, row.display_name));
  for (const { document, ...name } of rows(names, NAME)) {
    const source_document_id = idAt(result.documents, document);
    result.names.push({ ...name, source_document_id, supplier_id: row.id });
  }
  const members = array(raw[8]).map((value) => inheritedName(value, 2, row.display_name));
  for (const { version, field, ...member } of rows(members, MEMBER)) {
    const registry_version_id = idAt(result.versions, version);
    if (registry_version_id === null) throw new DataError(0);
    const registry_field_id = idAt(result.fields, field);
    result.memberships.push({
      ...member,
      registry_version_id,
      registry_field_id,
      supplier_id: row.id,
    });
  }
  for (const kind of array(raw[9]))
    result.contactKinds.push({ supplier_id: row.id, kind: text(kind) });
}

function references(raw: Record<string, unknown>) {
  const registries = rows(raw.registries, {
    id: text,
    name: text,
    owner_unit_id: optionalText,
    status: text,
  });
  const documents = rows(raw.documents, { id: text, url: text });
  const versions = rows(raw.versions, {
    id: text,
    registry: position,
    document: position,
    valid_from: optionalText,
    valid_until: optionalText,
  }).map(({ registry, document, ...version }) => ({
    ...version,
    registry_id: idAt(registries, registry) ?? '',
    source_document_id: idAt(documents, document),
  }));
  const fields = rows(raw.fields, { id: text, registry: position, source_text: text }).map(
    ({ registry, ...field }) => ({ ...field, registry_id: idAt(registries, registry) ?? '' }),
  );
  return { registries, documents, versions, fields };
}

/** See documentation/catalog-snapshot-contract-he.md for the ordered wire columns. */
export function compactCatalog(value: unknown): CatalogData {
  const raw = object(value);
  const result: CatalogData = {
    suppliers: [],
    names: [],
    memberships: [],
    contactKinds: [],
    ...references(raw),
    categories: rows(raw.categories, { id: text, name: text, parent_id: optionalText }),
    fieldCategories: rows(raw.fieldCategories, { registry_field_id: text, category_id: text }),
    units: rows(raw.units, { id: text, name: text }),
  };
  for (const value of array(raw.suppliers)) supplier(value, result);
  return result;
}

import type { CatalogData, IdentifierState, Venue } from './data/catalog.ts';
import { normalize } from './catalog-search.ts';

export type Validity = 'valid' | 'expired' | 'undated' | 'future';
export interface Membership {
  registryId: string;
  registry: string;
  fieldId: string | null;
  field: string;
  searchText: string;
  categories: CategoryLabel[];
  unitId: string | null;
  unit: string;
  validFrom: string | null;
  validUntil: string | null;
  source: string | null;
  page: number | null;
  /** `needs_review` until an editor or manager verifies the membership. */
  reviewStatus: string;
  registryClosed: boolean;
}
export interface CategoryLabel {
  categoryId: string;
  categoryName: string;
  parentCategoryId: string | null;
  parentCategoryName: string;
}
export interface Supplier {
  id: string;
  name: string;
  aliases: string[];
  searchNames: string[];
  verified: boolean;
  identifier: IdentifierState;
  /** Set only for an inactive supplier: why, according to whom and since when. */
  inactive: { reason: string; source: string | null; changedOn: string | null } | null;
  memberships: Membership[];
  /** Kinds of current contact details on record; the values load with the supplier. */
  contactKinds: string[];
  /** Hall details for a venue, null for every other supplier. */
  venue: Venue | null;
}

export function validity(membership: Membership, today: string): Validity {
  if (membership.validFrom !== null && membership.validFrom > today) return 'future';
  if (membership.validUntil === null) return 'undated';
  return membership.validUntil < today ? 'expired' : 'valid';
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = result.get(id) ?? [];
    group.push(row);
    result.set(id, group);
  }
  return result;
}

function lookup(data: CatalogData) {
  return {
    versions: new Map(data.versions.map((row) => [row.id, row])),
    registries: new Map(data.registries.map((row) => [row.id, row])),
    fields: new Map(data.fields.map((row) => [row.id, row])),
    categories: new Map(data.categories.map((row) => [row.id, row])),
    fieldCategories: groupBy(data.fieldCategories, (row) => row.registry_field_id),
    units: new Map(data.units.map((row) => [row.id, row])),
    documents: new Map(data.documents.map((row) => [row.id, row])),
  };
}

type Lookup = ReturnType<typeof lookup>;
type MemberRow = CatalogData['memberships'][number];
function optional<T>(map: Map<string, T>, key: string | null): T | undefined {
  return map.get(key ?? '');
}

function categoryLabels(fieldId: string | null, refs: Lookup): CategoryLabel[] {
  return (refs.fieldCategories.get(fieldId ?? '') ?? []).flatMap((link) => {
    const category = refs.categories.get(link.category_id);
    if (!category) return [];
    const parent = optional(refs.categories, category.parent_id);
    return [
      {
        categoryId: category.id,
        categoryName: category.name,
        parentCategoryId: parent?.id ?? null,
        parentCategoryName: parent?.name ?? '',
      },
    ];
  });
}

function labels(
  row: MemberRow,
  context: {
    registry: CatalogData['registries'][number];
    version: CatalogData['versions'][number];
  },
  refs: Lookup,
) {
  const { registry, version } = context;
  const field = optional(refs.fields, row.registry_field_id);
  const unit = optional(refs.units, registry.owner_unit_id);
  const document = optional(refs.documents, version.source_document_id);
  const fieldText = field?.source_text ?? '';
  return {
    fieldId: field?.id ?? null,
    field: fieldText,
    searchText: normalize(fieldText),

    unit: unit?.name ?? '',
    source: document?.url ?? null,
  };
}

function member(row: MemberRow, refs: Lookup): Membership | null {
  const version = refs.versions.get(row.registry_version_id);
  const registry = version && refs.registries.get(version.registry_id);
  if (!version || !registry) return null;
  return {
    registryId: registry.id,
    registry: registry.name,
    ...labels(row, { registry, version }, refs),
    categories: categoryLabels(row.registry_field_id, refs),
    unitId: registry.owner_unit_id,
    validFrom: row.registered_from,
    // The supplier's own date wins; otherwise the registry's (Menash, 25.11).
    validUntil: row.registered_until ?? version.valid_until,
    page: row.source_page,
    reviewStatus: row.review_status,
    registryClosed: registry.status === 'closed',
  };
}

function inactiveNote(row: CatalogData['suppliers'][number]): Supplier['inactive'] {
  if (row.status !== 'inactive') return null;
  return {
    reason: row.status_reason ?? 'לא צוינה סיבה',
    source: row.status_source,
    changedOn: row.status_changed_on,
  };
}

export function buildCatalog(data: CatalogData): Supplier[] {
  const refs = lookup(data);
  const names = groupBy(data.names, (row) => row.supplier_id);
  const memberships = groupBy(
    data.memberships.filter((row) => !['rejected', 'removed'].includes(row.review_status)),
    (row) => row.supplier_id,
  );
  const contactKinds = groupBy(data.contactKinds, (row) => row.supplier_id);
  return (
    data.suppliers
      .filter((row) => row.status !== 'merged')
      .map((row) => ({
        id: row.id,
        name: row.display_name,
        verified: row.review_status === 'verified',
        identifier: row.identifier_state,
        inactive: inactiveNote(row),
        aliases: [
          ...(names.get(row.id) ?? []).map((name) => name.name),
          ...(memberships.get(row.id) ?? []).flatMap((item) =>
            item.name_as_published ? [item.name_as_published] : [],
          ),
        ],
        memberships: (memberships.get(row.id) ?? [])
          .map((item) => member(item, refs))
          .filter((item): item is Membership => item !== null),
        contactKinds: (contactKinds.get(row.id) ?? []).map((item) => item.kind),
        venue: row.venue,
      }))
      // A supplier whose memberships are hidden by access rules must not be
      // displayed without the registry and source needed to interpret it.
      .filter((supplier) => supplier.memberships.length > 0)
      .map((supplier) => ({
        ...supplier,
        searchNames: [supplier.name, ...supplier.aliases].map(normalize),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
  );
}

import { validity, type Membership, type Supplier, type Validity } from './catalog-model.ts';
import { normalize } from './catalog-search.ts';

export interface Filters {
  query: string;
  registry: string;
  field: string;
  category: string;
  subcategory: string;
  unit: string;
  validity: Validity | '';
  identifier: IdentifierFilter;
  /** `venue` keeps only halls; a number keeps halls with at least that many seats. */
  venue: VenueFilter;
  /** Inactive suppliers stay hidden unless asked for or found by their own name. */
  showInactive: boolean;
  /** Memberships in closed registries (older versions) stay hidden unless asked for. */
  showClosed: boolean;
  today: string;
}
export type IdentifierFilter = '' | 'verified' | 'pending' | 'none';
export type VenueFilter = '' | 'venue' | '100' | '200' | '400';

function venueMatches(supplier: Supplier, wanted: VenueFilter): boolean {
  if (!wanted) return true;
  if (!supplier.venue) return false;
  return wanted === 'venue' || (supplier.venue.capacity ?? 0) >= Number(wanted);
}

function identifierMatches(supplier: Supplier, wanted: IdentifierFilter): boolean {
  if (!wanted) return true;
  return wanted === 'none' ? supplier.identifier === null : supplier.identifier === wanted;
}

function categoryMatches(member: Membership, filters: Filters): boolean {
  if (!filters.category && !filters.subcategory) return true;
  return member.categories.some(
    (category) =>
      (!filters.category ||
        category.categoryId === filters.category ||
        category.parentCategoryId === filters.category) &&
      (!filters.subcategory || category.categoryId === filters.subcategory),
  );
}

function openMatches(member: Membership, filters: Filters): boolean {
  return filters.showClosed || !member.registryClosed;
}

function membershipMatches(member: Membership, filters: Filters): boolean {
  return (
    (!filters.registry || member.registryId === filters.registry) &&
    (!filters.field || member.fieldId === filters.field) &&
    categoryMatches(member, filters) &&
    (!filters.unit || member.unitId === filters.unit) &&
    (!filters.validity || validity(member, filters.today) === filters.validity) &&
    openMatches(member, filters)
  );
}

export function filterCatalog(suppliers: Supplier[], filters: Filters): Supplier[] {
  const query = normalize(filters.query);
  return suppliers.filter((supplier) => {
    const members = supplier.memberships.filter((member) => membershipMatches(member, filters));
    if (members.length === 0 || !identifierMatches(supplier, filters.identifier)) return false;
    if (!venueMatches(supplier, filters.venue)) return false;
    const byName = !!query && supplier.searchNames.some((name) => name.includes(query));
    if (supplier.inactive && !filters.showInactive && !byName) return false;
    if (!query) return true;
    return byName || members.some((member) => member.searchText.includes(query));
  });
}

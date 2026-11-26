import type { Supplier, Validity } from '../../../catalog-model.ts';
import type { Filters, IdentifierFilter, VenueFilter } from '../../../catalog-filter.ts';
export { israelToday } from '../../../lib/dates.ts';
export interface Choice {
  value: string;
  label: string;
}
export type FilterKey =
  'registry' | 'field' | 'category' | 'subcategory' | 'unit' | 'validity' | 'identifier' | 'venue';
export type ToggleKey = 'showInactive' | 'showClosed';
function choices(pairs: Iterable<readonly [string, string]>): Choice[] {
  return [...new Map(pairs)]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'he'));
}
export function optionsFor(
  suppliers: Supplier[],
  selection: Pick<Filters, 'registry' | 'category'>,
) {
  const members = suppliers.flatMap((s) => s.memberships);
  const visible = members.filter((m) => !selection.registry || m.registryId === selection.registry);
  const categories = visible.flatMap((m) => m.categories);
  return {
    registry: choices(members.map((m) => [m.registryId, m.registry] as const)),
    field: choices(
      visible.flatMap((m) => (m.fieldId && m.field ? [[m.fieldId, m.field] as const] : [])),
    ),
    unit: choices(
      visible.flatMap((m) => (m.unitId && m.unit ? [[m.unitId, m.unit] as const] : [])),
    ),
    category: choices(
      categories.map((c) =>
        c.parentCategoryId && c.parentCategoryName
          ? ([c.parentCategoryId, c.parentCategoryName] as const)
          : ([c.categoryId, c.categoryName] as const),
      ),
    ),
    subcategory: choices(
      categories
        .filter((c) => c.parentCategoryId === selection.category)
        .map((c) => [c.categoryId, c.categoryName] as const),
    ),
  };
}
export function emptyFilters(today: string): Filters {
  return {
    today,
    query: '',
    registry: '',
    field: '',
    category: '',
    subcategory: '',
    unit: '',
    validity: '',
    identifier: '',
    venue: '',
    showInactive: false,
    showClosed: false,
  };
}
function selected(options: Choice[], value: string): string {
  return options.some((o) => o.value === value) ? value : '';
}
export function parseValidity(value: string): Validity | '' {
  return value === 'valid' || value === 'expired' || value === 'undated' || value === 'future'
    ? value
    : '';
}
export function parseIdentifier(value: string): IdentifierFilter {
  return value === 'verified' || value === 'pending' || value === 'none' ? value : '';
}
export function parseVenue(value: string): VenueFilter {
  return ['venue', '100', '200', '400'].includes(value) ? (value as VenueFilter) : '';
}
/** Resets dependent selections just as the legacy selects do when their option disappears. */
export function reconcile(filters: Filters, suppliers: Supplier[]): Filters {
  const all = optionsFor(suppliers, { registry: '', category: '' });
  const registry = selected(all.registry, filters.registry);
  let options = optionsFor(suppliers, { registry, category: filters.category });
  const category = selected(options.category, filters.category);
  options = optionsFor(suppliers, { registry, category });
  return {
    ...filters,
    registry,
    category,
    field: selected(options.field, filters.field),
    unit: selected(options.unit, filters.unit),
    subcategory: selected(options.subcategory, filters.subcategory),
    validity: parseValidity(filters.validity),
    identifier: parseIdentifier(filters.identifier),
    venue: parseVenue(filters.venue),
  };
}
export function changeFilter(
  filters: Filters,
  change: { key: FilterKey; value: string },
  suppliers: Supplier[],
): Filters {
  const { key, value } = change;
  const next = { ...filters, [key]: value };
  return reconcile(next, suppliers);
}

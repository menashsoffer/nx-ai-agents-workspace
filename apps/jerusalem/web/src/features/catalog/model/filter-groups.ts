// Which catalog filters are always in view and which wait behind "עוד מסננים"
// (screens-spec-he.md 1, decision 2), and the labels of the active ones as removable tags.
import type { Filters } from '../../../catalog-filter.ts';
import type { Supplier } from '../../../catalog-model.ts';
import {
  emptyFilters,
  optionsFor,
  type Choice,
  type FilterKey,
  type ToggleKey,
} from './filters.ts';

export const PRIMARY: readonly FilterKey[] = ['registry', 'field', 'unit', 'validity'];
export const MORE: readonly FilterKey[] = ['category', 'subcategory', 'identifier', 'venue'];
export const TOGGLES: readonly { key: ToggleKey; label: string; tag: string }[] = [
  { key: 'showInactive', label: 'להציג גם ספקים לא פעילים', tag: 'כולל לא פעילים' },
  {
    key: 'showClosed',
    label: 'להציג גם מאגרים סגורים וגרסאות קודמות',
    tag: 'כולל מאגרים סגורים',
  },
];

export const LABELS: Record<FilterKey, string> = {
  registry: 'מאגר',
  field: 'תחום',
  category: 'קטגוריה',
  subcategory: 'תת־קטגוריה',
  unit: 'יחידה',
  validity: 'תוקף',
  identifier: 'ח.פ.',
  venue: 'מתקנים ואולמות',
};

const FIXED: Partial<Record<FilterKey, Choice[]>> = {
  validity: [
    { value: 'valid', label: 'בתוקף' },
    { value: 'expired', label: 'פג תוקף' },
    { value: 'undated', label: 'ללא תאריך סיום' },
    { value: 'future', label: 'טרם החל' },
  ],
  identifier: [
    { value: 'verified', label: 'ח.פ. מאושר' },
    { value: 'pending', label: 'ח.פ. ממתין לאישור' },
    { value: 'none', label: 'אין ח.פ. מאושר' },
  ],
  venue: [
    { value: 'venue', label: 'כל המתקנים' },
    { value: '100', label: 'לפחות 100 מקומות' },
    { value: '200', label: 'לפחות 200 מקומות' },
    { value: '400', label: 'לפחות 400 מקומות' },
  ],
};

export type Options = ReturnType<typeof optionsFor>;

export function choicesFor(key: FilterKey, options: Options): Choice[] {
  return FIXED[key] ?? options[key as keyof Options];
}

export interface ActiveTag {
  /** What removing the tag resets. */
  key: FilterKey | ToggleKey;
  text: string;
}

/** "מאגר: יועצים משפטיים", in the order the controls appear. */
export function activeTags(filters: Filters, suppliers: Supplier[]): ActiveTag[] {
  const options = optionsFor(suppliers, filters);
  const tags: ActiveTag[] = [...PRIMARY, ...MORE].flatMap((key) => {
    const value = filters[key];
    if (!value) return [];
    const label = choicesFor(key, options).find((c) => c.value === value)?.label ?? value;
    return [{ key, text: `${LABELS[key]}: ${label}` }];
  });
  for (const toggle of TOGGLES)
    if (filters[toggle.key]) tags.push({ key: toggle.key, text: toggle.tag });
  return tags;
}

/** How many of the given filters are set, for the counter on the filters button. */
export function countSet(filters: Filters, keys: readonly FilterKey[], toggles: boolean): number {
  const set = keys.filter((key) => filters[key]).length;
  return set + (toggles ? TOGGLES.filter((t) => filters[t.key]).length : 0);
}

/** Removes one tag; removing a category also removes its subcategory. */
export function withoutTag(filters: Filters, key: ActiveTag['key']): Filters {
  if (key === 'showInactive' || key === 'showClosed') return { ...filters, [key]: false };
  const next = { ...filters, [key]: '' };
  return key === 'category' ? { ...next, subcategory: '' } : next;
}

/** Clears every filter and keeps the search text. */
export function clearFilters(filters: Filters): Filters {
  return { ...emptyFilters(filters.today), query: filters.query };
}

/** Clears the given filters and both toggles, for "ניקוי" inside the filters dialog. */
export function clearKeys(filters: Filters, keys: readonly FilterKey[]): Filters {
  const next = { ...filters, showInactive: false, showClosed: false };
  for (const key of keys) next[key] = '';
  return next;
}

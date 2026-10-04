export type ClassValue =
  | string
  | false
  | null
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

/**
 * Joins class names, skipping falsy values: `cn('p-2', isActive && 'bg-brand-600')`.
 * Accepts nested arrays and `{ className: condition }` objects, clsx-style.
 * Does not merge or dedupe conflicting Tailwind utility classes: `cn('p-2', 'p-4')`
 * keeps both, in call order.
 */
export function cn(...classes: ClassValue[]): string {
  return classes.flatMap(toClassNames).join(' ');
}

function toClassNames(value: ClassValue): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(toClassNames);
  return Object.entries(value)
    .filter(([, isEnabled]) => isEnabled)
    .map(([className]) => className);
}

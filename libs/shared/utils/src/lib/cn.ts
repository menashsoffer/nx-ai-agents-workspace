export type ClassValue = string | false | null | undefined;

/** Joins class names, skipping falsy values: `cn('p-2', isActive && 'bg-brand-600')`. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}

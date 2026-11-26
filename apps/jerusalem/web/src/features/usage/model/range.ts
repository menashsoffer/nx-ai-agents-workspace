// The period and role the dashboard shows, read from the address (?days=30&role=supplier).
export const PERIODS = [7, 30, 90] as const;
export const ROLES = [
  'admin',
  'auditor',
  'unit_manager',
  'editor',
  'viewer',
  'supplier',
  'other',
] as const;
export type UsageRole = (typeof ROLES)[number];

export interface Range {
  days: number;
  from: string;
  to: string;
  role: UsageRole | null;
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` plus a number of days, in calendar days. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function isRole(value: string | null): value is UsageRole {
  return ROLES.some((role) => role === value);
}

export function rangeOf(params: URLSearchParams, today: string): Range {
  const asked = Number(params.get('days'));
  const days = PERIODS.find((period) => period === asked) ?? 30;
  const role = params.get('role');
  return { days, from: addDays(today, 1 - days), to: today, role: isRole(role) ? role : null };
}

/** Every day of the range, oldest first, so a day with no visits still shows. */
export function daysOf(range: Range): string[] {
  return Array.from({ length: range.days }, (_, i) => addDays(range.from, i));
}

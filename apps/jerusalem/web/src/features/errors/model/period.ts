// The period the errors screen shows, read from the address (?days=30, ?days=all).
export const PERIODS = [
  { key: '1', days: 1, label: '24 השעות האחרונות' },
  { key: '7', days: 7, label: '7 הימים האחרונים' },
  { key: '30', days: 30, label: '30 הימים האחרונים' },
  { key: 'all', days: null, label: 'מההתחלה' },
] as const;
export type Period = (typeof PERIODS)[number];

export interface ErrorView {
  period: Period;
  /** Only the groups that need someone: a fault in the system or an unreachable database. */
  urgentOnly: boolean;
}

export function viewOf(params: URLSearchParams): ErrorView {
  const asked = params.get('days');
  const period = PERIODS.find((p) => p.key === asked) ?? PERIODS[1];
  return { period, urgentOnly: params.get('urgent') === '1' };
}

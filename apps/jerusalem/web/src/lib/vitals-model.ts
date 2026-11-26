import type { FailureKind } from './errors/failure.ts';
// Project budgets: documentation/react-guide-he.md, section 6 (milliseconds, CLS score).
export const VITAL_BUDGETS = { LCP: 1500, INP: 200, CLS: 0.1 };
export type VitalName = keyof typeof VITAL_BUDGETS;
export interface VitalReport {
  name: VitalName;
  value: number;
  bounded: boolean;
}
export interface ErrorReport {
  name: 'error';
  error_code: string;
  /** 'action': shown beside a button or form; the others replaced a screen or the page. */
  boundary: 'root' | 'route' | 'bootstrap' | 'action';
  /** error-handling-spec-he.md section 3; fixed values only. */
  kind?: FailureKind;
  /** The rest is added after the first screen (error-details-spec-he.md section 3). */
  screen?: string;
  cause?: ErrorCause;
  request?: string;
  device?: 'desktop' | 'mobile';
  site_version?: string;
}
/** What failed, from a fixed list (error-details-spec-he.md section 3). */
export type ErrorCause =
  'superseded' | 'bad_answer' | 'http' | 'network' | 'render' | 'stale_files' | 'rule' | 'unknown';
export type TelemetryEvent = VitalReport | ErrorReport;
const MAX_INTERACTIONS = 10;
const EVENT_THRESHOLD = 16;
const valid = (n: number) => Number.isFinite(n) && n >= 0;
/** Keep the ten slowest interactions, not each keydown/keyup as a separate interaction. */
function inp(interactions: Map<number, number>, count?: number): VitalReport | null {
  const times = [...interactions.values()].sort((a, b) => b - a);
  if (!times.length) return count ? { name: 'INP', value: EVENT_THRESHOLD, bounded: true } : null;
  if (count === undefined) return { name: 'INP', value: times[0] ?? 0, bounded: true };
  const rank = Math.floor(count / 50);
  if (rank >= times.length && times.length < MAX_INTERACTIONS)
    return { name: 'INP', value: EVENT_THRESHOLD, bounded: true };
  return {
    name: 'INP',
    value: times[Math.min(rank, MAX_INTERACTIONS - 1)] ?? 0,
    bounded: rank >= MAX_INTERACTIONS,
  };
}
export function createVitalsModel() {
  let lcp: number | null = null,
    cls = 0,
    session = 0,
    first: number | null = null,
    last = 0;
  const interactions = new Map<number, number>();
  return {
    lcp(value: number) {
      if (valid(value)) lcp = Math.max(lcp ?? 0, value);
    },
    interaction(id: number, duration: number) {
      if (!Number.isSafeInteger(id) || id <= 0 || !valid(duration)) return;
      interactions.set(id, Math.max(duration, interactions.get(id) ?? 0));
      if (interactions.size > MAX_INTERACTIONS) {
        const smallest = [...interactions].sort((a, b) => a[1] - b[1])[0];
        if (smallest) interactions.delete(smallest[0]);
      }
    },
    shift(time: number, value: number, recent: boolean) {
      if (recent || !valid(time) || !valid(value)) return;
      if (first === null || time - last >= 1000 || time - first >= 5000) {
        first = time;
        session = 0;
      }
      last = time;
      session += value;
      cls = Math.max(cls, session);
    },
    reports(count?: number): VitalReport[] {
      const values: VitalReport[] = [
        { name: 'CLS', value: Math.round(cls * 10000) / 10000, bounded: false },
      ];
      if (lcp !== null) values.push({ name: 'LCP', value: Math.round(lcp), bounded: false });
      const interaction = inp(interactions, count);
      if (interaction) values.push({ ...interaction, value: Math.round(interaction.value) });
      return values;
    },
  };
}
const HTTP_CODES: Record<number, string> = {
  401: 'http_401',
  403: 'http_403',
  404: 'http_404',
  429: 'http_429',
};
/** Never read message, stack, URL, response body, component props or form data. */
export function errorCode(error: unknown): string {
  try {
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? error.status : 0;
    if (typeof status !== 'number') return 'unexpected';
    return HTTP_CODES[status] ?? (status >= 500 && status <= 599 ? 'http_5xx' : 'unexpected');
  } catch {
    return 'unexpected';
  }
}

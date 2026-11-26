// The usage event shape and the rules that keep it free of personal data: screens are named
// by route pattern (no ids from the address), actions by fixed slugs, times in whole ms.

export type UsageKind = 'visit_start' | 'screen_view' | 'action' | 'step' | 'visit_end';
export type Device = 'desktop' | 'mobile';

export interface UsageEvent {
  visit_id: string;
  kind: UsageKind;
  screen: string;
  device: Device;
  action?: string;
  step?: number;
  duration_ms?: number;
}

const SCREEN = /^[a-z][a-z0-9-]{0,39}$/;
const ACTION = /^[a-z][a-z0-9_.-]{0,59}$/;
const DAY_MS = 86_400_000;

/** "supplier/:id" becomes "supplier"; the catch-all route becomes "not-found". */
export function screenName(paths: readonly (string | undefined)[]): string {
  if (paths.includes('*')) return 'not-found';
  const parts = paths
    .flatMap((path) => (path ?? '').split('/'))
    .filter((part) => part !== '' && !part.startsWith(':'));
  const name = parts.join('-').toLowerCase();
  if (name === '') return 'home';
  return SCREEN.test(name) ? name : 'other';
}

export function actionName(value: string | null | undefined): string | null {
  return value && ACTION.test(value) ? value : null;
}

export function durationMs(ms: number): number {
  return Math.min(DAY_MS, Math.max(0, Math.round(ms)));
}

export function stepNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20
    ? value
    : null;
}

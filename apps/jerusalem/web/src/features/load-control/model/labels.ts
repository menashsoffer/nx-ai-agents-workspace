const JOB_STATUS: Record<string, string> = { running: 'רץ', ok: 'הצליח', failed: 'נכשל' };
const REGISTRY_STATUS: Record<string, string> = {
  active: 'פעיל',
  closed: 'סגור',
  unknown: 'לא ידוע',
};
const SOURCES: Record<string, string> = {
  companies_registrar: 'רשם החברות',
  nonprofits_registrar: 'רשם העמותות',
  guidestar: 'גיידסטאר',
};

export function jobStatus(status: string): string {
  return JOB_STATUS[status] ?? status;
}
export function registryStatus(status: string): string {
  return REGISTRY_STATUS[status] ?? status;
}
export function sourceLabel(source: string): string {
  return SOURCES[source] ?? source;
}

export { when } from '../../../lib/dates.ts';

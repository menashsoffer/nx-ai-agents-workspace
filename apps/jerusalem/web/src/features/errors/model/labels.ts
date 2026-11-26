// Plain Hebrew for what each error was (error-details-spec-he.md sections 3 and 4).
import { screenLabel } from '../../../lib/screen-names.ts';
import type { ErrorGroup } from './groups.ts';

const CAUSES: Record<string, string> = {
  superseded: 'הבקשה בוטלה כי יצאה אחריה בקשה זהה',
  bad_answer: 'השרת ענה בצורה שהאתר לא מצפה לה',
  http: 'השרת החזיר שגיאה',
  network: 'הבקשה לא הגיעה לשרת או לא חזרה בזמן',
  render: 'המסך נפל בגלל תקלה בקוד',
  stale_files: 'חלק מהאתר לא נטען, כנראה אחרי עדכון גרסה',
  rule: 'המסד דחה ערך לפי כלל תוכן',
  unknown: 'הסיבה לא נרשמה (שגיאה מלפני שהתחלנו לרשום אותה)',
};
const WHERE: Record<string, string> = {
  route: 'במקום המסך',
  action: 'ליד כפתור או טופס',
  root: 'במקום כל הדף',
  bootstrap: 'בפתיחת האתר',
};
const DEVICES: Record<string, string> = { desktop: 'מחשב', mobile: 'נייד' };
const HTTP: Record<string, string> = {
  http_401: 'ההתחברות לא בתוקף (401)',
  http_403: 'אין הרשאה (403)',
  http_404: 'לא נמצא (404)',
  http_429: 'יותר מדי בקשות (429)',
  http_5xx: 'תקלה בשרת (5xx)',
};

export function causeLabel(cause: string): string {
  return CAUSES[cause] ?? cause;
}
export function whereLabel(boundary: string | null): string {
  return (boundary && WHERE[boundary]) ?? 'לא ידוע';
}
export function deviceLabel(device: string | null): string {
  return (device && DEVICES[device]) ?? '—';
}

/** One sentence: where it happened, what failed, and which request. */
export function sentence(group: ErrorGroup): string {
  const http = group.cause === 'http' && group.errorCode ? HTTP[group.errorCode] : undefined;
  const parts = [`במסך "${screenLabel(group.screen)}": ${causeLabel(group.cause)}`];
  if (http) parts.push(`, ${http}`);
  if (group.request) parts.push(`. הבקשה לשרת: ${group.request}`);
  return `${parts.join('')}.`;
}

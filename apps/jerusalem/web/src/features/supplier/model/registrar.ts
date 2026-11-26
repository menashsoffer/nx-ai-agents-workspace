// What the registries said about the supplier's numbers (alignment review, stage B, 25.11),
// as rows of the verdict band. Never "clean": the rows say where no flag was found and what
// was not checked. Values the registries send that we do not know are shown as they came.
import type { Json } from '../../../database.types.ts';
import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import type { VerdictRow } from './verdict.ts';

type Identifier = SupplierDetail['identifiers'][number];

export const CHECK_LABELS: Record<string, string> = {
  registrar: 'רשם החברות',
  guidestar: 'גיידסטאר',
  amutot: 'רשם העמותות',
  proper: 'ניהול תקין',
  events: 'אירועים ברשם',
};

// The same words as private.registry_inactive in the database.
const INACTIVE = /מחוק|מחיקה|נמחק|מחוסל|פירוק|פורק|לא פעיל|בוטל|לא נמצא/u;
const ACTIVE = new Set(['פעילה', 'רשומה']);
const REPORT_YEARS_LATE = 2;

function details(item: Identifier): Record<string, Json> {
  const value = item.registry_details;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const field = (d: Record<string, Json>, key: string) => {
  const value = d[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

function statusFlag(item: Identifier): VerdictRow | null {
  const status = item.registrar_status;
  if (!status || ACTIVE.has(status)) return null;
  const detail = `מספר ${item.value}: ${status}`;
  return INACTIVE.test(status)
    ? { state: 'bad', title: 'הרשם מסר שהגוף לא פעיל', detail }
    : { state: 'warn', title: 'סטטוס לא רגיל ברשם', detail };
}

/** Flags from the companies registrar row: breach, sub-status, a late annual report. */
function companyFlags(d: Record<string, Json>, year: number): VerdictRow[] {
  const rows: VerdictRow[] = [];
  const breach = field(d, 'מפרה');
  if (breach) rows.push({ state: 'warn', title: 'מסומנת כחברה מפרה', detail: breach });
  const sub = field(d, 'תת סטטוס');
  if (sub) rows.push({ state: 'warn', title: 'תת סטטוס ברשם', detail: sub.split(';').join(', ') });
  const report = Number(field(d, 'שנה אחרונה של דוח שנתי (שהוגש)') ?? 'NaN');
  if (Number.isFinite(report) && report < year - REPORT_YEARS_LATE)
    rows.push({
      state: 'warn',
      title: 'הדוח השנתי לא הוגש בזמן',
      detail: `אחרון: ${String(report)}`,
    });
  return rows;
}

/** Flags from data.gov.il: no certificate this year, and events other than a lien removal. */
function datagovFlags(d: Record<string, Json>): VerdictRow[] {
  const rows: VerdictRow[] = [];
  const proper = field(d, 'ניהול תקין');
  if (proper && !proper.startsWith('נחתם אישור'))
    rows.push({ state: 'warn', title: 'אין אישור ניהול תקין לשנה הזו', detail: proper });
  const events = field(d, 'אירועים ב-12 החודשים האחרונים');
  const real = events?.split('; ').filter((e) => !e.startsWith('סילוק'));
  if (real?.length)
    rows.push({ state: 'warn', title: 'אירועים ברשם בשנה האחרונה', detail: real.join('; ') });
  return rows;
}

function checksOf(d: Record<string, Json>): Record<string, Json> {
  const value = d.checks;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Labels of the checks that ran, and of those that did not, over all checked numbers. */
function coverage(items: Identifier[]): { done: string[]; missing: string[] } {
  const done = new Set<string>();
  const missing = new Set<string>();
  for (const item of items) {
    const checks = checksOf(details(item));
    for (const [key, label] of Object.entries(CHECK_LABELS)) {
      if (!(key in checks)) continue;
      (checks[key] === 'ok' ? done : missing).add(label);
    }
  }
  for (const label of done) missing.delete(label);
  return { done: [...done], missing: [...missing] };
}

const NOTHING: VerdictRow = {
  state: 'none',
  title: 'לא נבדק ברשמים',
  detail: 'אין מספר מזהה שנבדק. סטטוס ברשם, סימון מפרה ואירועים (שעבודים, פירוק) לא נבדקו',
};

export function registrarRows(data: SupplierDetail, today: string): VerdictRow[] {
  const items = data.identifiers.filter(
    (i) => (i.scheme === 'company' || i.scheme === 'nonprofit') && i.review_status !== 'rejected',
  );
  const checked = items.filter((i) => i.checked_at);
  if (!checked.length) return [NOTHING];
  const year = Number(today.slice(0, 4));
  const flags = checked.flatMap((i) => [
    statusFlag(i),
    ...companyFlags(details(i), year),
    ...datagovFlags(details(i)),
  ]);
  const rows = flags.filter((r): r is VerdictRow => r !== null);
  const { done, missing } = coverage(checked);
  const where = done.length ? done.join(', ') : 'הרשם';
  const notChecked = missing.length ? `. לא נבדק: ${missing.join(', ')}` : '';
  if (!rows.length)
    rows.push({
      state: 'ok',
      title: 'לא נמצא סימון ברשמים',
      detail: `נבדק ב: ${where}${notChecked}`,
    });
  else if (missing.length)
    rows.push({ state: 'none', title: 'לא נבדק', detail: missing.join(', ') });
  return rows;
}

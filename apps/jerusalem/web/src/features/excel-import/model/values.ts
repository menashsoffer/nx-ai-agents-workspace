// Turns one mapped row into the values the database expects (spec section 5), and lists what
// is wrong with it. A value that fails its rule is left out of `edited` and stays in `raw`.
import type { Field } from './columns.ts';
import { unsafeReason } from './safety.ts';

export type Edited = Partial<Record<Exclude<Field, 'note'>, string>>;
export interface Issue {
  field: Field;
  text: string;
}

const KINDS: Record<string, string> = {
  חברה: 'company',
  חלצ: 'company',
  עמותה: 'nonprofit',
  שותפות: 'partnership',
  עוסק: 'sole_trader',
  עוסקמורשה: 'sole_trader',
  עוסקפטור: 'sole_trader',
  אדםפרטי: 'sole_trader',
  אגודהשיתופית: 'cooperative',
  גוףציבורי: 'public_body',
  לאידוע: '',
};
const SCHEMES: Record<string, string> = {
  חפ: 'company',
  ער: 'nonprofit',
  עוסקמורשה: 'vat_dealer',
  תז: 'personal_id',
};

const squeeze = (text: string) => text.replace(/[\s"'״׳.-]/g, '');

/** A word that starts with a final letter: the cell was typed or copied in reverse. */
export const looksReversed = (text: string) => /(^|\s)[םןץףך][א-ת]/.test(text);

type Check = (value: string) => { value: string } | { issue: string };

const CHECKS: Partial<Record<Field, Check>> = {
  entity_kind: (v) => {
    const kind = KINDS[squeeze(v)];
    return kind === undefined ? { issue: `סוג ספק לא מוכר: ${v}` } : { value: kind };
  },
  scheme: (v) => {
    const scheme = SCHEMES[squeeze(v)];
    return scheme ? { value: scheme } : { issue: `סוג מזהה לא מוכר: ${v}` };
  },
  value: (v) => {
    const digits = v.replace(/[\s-]/g, '');
    return /^\d{5,9}$/.test(digits) ? { value: digits } : { issue: 'מספר מזהה: 5 עד 9 ספרות' };
  },
  phone: (v) => {
    const digits = v.replace(/[\s()-]/g, '').replace(/^\+972/, '0');
    if (/^0\d{8,9}$/.test(digits) || /^\*?\d{4}$/.test(digits)) return { value: v };
    return { issue: digits.length > 10 ? 'נראה כמו שני מספרים מחוברים' : 'טלפון לא תקין' };
  },
  email: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? { value: v } : { issue: 'דוא״ל לא תקין' }),
  website: (v) =>
    /^https?:\/\/\S+$/i.test(v) ? { value: v } : { issue: 'אתר חייב להתחיל ב-http:// או https://' },
};

function checked(field: Field, raw: string, issues: Issue[]): string | null {
  const value = raw.trim();
  if (!value) return null;
  const unsafe = unsafeReason(value);
  if (unsafe) {
    issues.push({ field, text: unsafe });
    return null;
  }
  if (looksReversed(value)) issues.push({ field, text: 'נראה שהטקסט הפוך' });
  const check = CHECKS[field];
  if (!check) return value;
  const result = check(value);
  if ('issue' in result) {
    issues.push({ field, text: result.issue });
    return null;
  }
  return result.value;
}

/** Rules across fields: an identifier needs its kind, and a supplier needs a way to reach it. */
function crossChecks(edited: Edited, issues: Issue[]): void {
  if (!edited.name) issues.push({ field: 'name', text: 'חסר שם ספק' });
  if (edited.value && !edited.scheme) {
    issues.push({ field: 'scheme', text: 'יש מספר מזהה בלי סוג מזהה, ולכן הוא לא נקלט' });
    delete edited.value;
  }
  if (edited.scheme && !edited.value) delete edited.scheme;
  const reachable = [edited.value, edited.phone, edited.email, edited.address].some(Boolean);
  if (!reachable) issues.push({ field: 'value', text: 'אין מספר מזהה ואין פרט קשר' });
}

/** The mapped values of one row and the problems found in them. */
export function editedRow(cells: Partial<Record<Field, string>>): {
  edited: Edited;
  issues: Issue[];
} {
  const issues: Issue[] = [];
  const edited: Edited = {};
  for (const [field, raw] of Object.entries(cells) as [Field, string][]) {
    if (field === 'note') continue;
    const value = checked(field, raw, issues);
    if (value !== null) edited[field] = value;
  }
  crossChecks(edited, issues);
  return { edited, issues };
}

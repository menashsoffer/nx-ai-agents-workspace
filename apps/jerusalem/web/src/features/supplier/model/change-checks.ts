import type {
  ChangeKind,
  Check,
  CheckResult,
  Outcome,
  SupplierChange,
} from '../../../data/supplier-changes.ts';
import { RULE_MESSAGES } from '../../../lib/rules/messages.ts';
import { CONTACT_KINDS, ENTITY_KINDS } from './labels.ts';

/** What a change is about, in the words of the edit dialog. */
export function changeLabel(kind: ChangeKind, contactKind?: string | null): string {
  if (kind === 'rename') return 'שם הספק';
  if (kind === 'entity_kind') return 'סוג ישות';
  return CONTACT_KINDS[contactKind ?? ''] ?? 'פרט קשר';
}

/** A contact change with no value deletes the contact (migration 20261123000000). */
export const isRemoval = (kind: ChangeKind, value: string | null) => kind === 'contact' && !value;

/** The value as a person reads it: a kind by its Hebrew name. */
export function changeValue(kind: ChangeKind, value: string | null): string {
  if (value === null || value === '') return '—';
  return kind === 'entity_kind' ? (ENTITY_KINDS[value] ?? value) : value;
}

const PROBLEMS: Record<string, string | undefined> = {
  no_change: 'הערך זהה לערך הנוכחי.',
  bad_choice: 'הבחירה לא קיימת ברשימה.',
  contact_missing: 'הפרט הקודם כבר הוחלף או נמחק. רעננו את הדף ונסו שוב.',
  duplicate_contact:
    'הפרט הזה כבר רשום אצל הספק בשורה אחרת. כדי להיפטר מהכפילות, מחקו את השורה הזאת בפח.',
  no_identifier: 'אין לספק מספר מזהה שמאשר את הסוג, ולכן מנהל מערכת יאשר.',
};
const RULES: Record<string, string | undefined> = RULE_MESSAGES;
const problemText = (check: Check) =>
  PROBLEMS[check.problem ?? ''] ?? RULES[check.problem ?? ''] ?? 'הערך לא תקין.';

type Texts = Partial<Record<Outcome, (check: Check) => string>>;
const TEXTS: Record<string, Texts> = {
  name_rule: { red: problemText },
  kind_rule: { red: problemText },
  contact_rule: { red: problemText, green: () => 'הפרט תקין.' },
  other_supplier: {
    red: (c) => `יש כבר ספק פעיל בשם הזה: ${c.name ?? ''}. בקשו ממנהל מערכת למזג במקום לשנות שם.`,
    yellow: (c) => `השם דומה מאוד לספק אחר: ${c.name ?? ''}. בדקו שזה לא אותו ספק.`,
  },
  registrar_name: {
    green: () => 'השם זהה לשם ברשם.',
    yellow: (c) => `השם שונה מהשם ברשם: ${c.name ?? ''}.`,
  },
  registry_status: {
    green: (c) => `המרשם מראה שהתאגיד במצב: ${c.name ?? ''}.`,
    yellow: (c) => `לפי המרשם התאגיד במצב: ${c.name ?? ''}. אפשר לשמור עם סיבה, והספק סומן לבדיקה.`,
  },
  no_registry: { yellow: () => 'לעוסק אין מרשם פתוח להשוואה, ולכן מנהל מערכת יאשר.' },
  change_size: {
    green: () => 'שינוי כתיב קטן.',
    yellow: () => 'השם השתנה לגמרי, ולכן מנהל מערכת יאשר.',
  },
  identifier_kind: {
    green: () => 'הסוג מתאים למספר המזהה.',
    yellow: (c) => (c.problem ? problemText(c) : 'הסוג לא מתאים למספר המזהה שממתין לבדיקה.'),
    red: () => 'הסוג סותר את המספר המאומת במרשם.',
  },
  name_kind: {
    green: () => 'הסוג מתאים לשם הספק.',
    yellow: () => 'הסוג לא מתאים לשם הספק.',
  },
  contact_removal: {
    green: (c) => `הפרט יימחק: ${c.name ?? ''}.`,
    yellow: (c) => `זה הפרט האחרון מסוגו אצל הספק (${c.name ?? ''}), ולכן עורך אחר יאשר את המחיקה.`,
    red: problemText,
  },
  shared_contact: {
    yellow: (c) => `אותו פרט רשום גם אצל ${c.name ?? 'ספק אחר'}. אולי זה אותו ספק.`,
  },
};
const FALLBACK: Record<Outcome, string> = {
  green: 'הבדיקה עברה.',
  yellow: 'צריך אישור.',
  red: 'הבדיקה לא עברה.',
};

/** One sentence per check, in Hebrew. */
export function checkText(check: Check): string {
  return TEXTS[check.check]?.[check.outcome]?.(check) ?? FALLBACK[check.outcome];
}

export interface CheckedChange {
  change: SupplierChange;
  result: CheckResult;
}

export function overall(checked: readonly CheckedChange[]): Outcome {
  if (checked.some((item) => item.result.outcome === 'red')) return 'red';
  return checked.some((item) => item.result.outcome === 'yellow') ? 'yellow' : 'green';
}

/** Spec section 5: a rename always, a yellow name or kind change, and any yellow by an admin. */
export function reasonNeeded(checked: readonly CheckedChange[], admin: boolean): boolean {
  return checked.some(
    ({ change, result }) =>
      change.kind === 'rename' ||
      (result.outcome === 'yellow' && (admin || change.kind !== 'contact')),
  );
}

/** Whether saving sends something for a decision rather than saving it at once. */
export const waitsForDecision = (checked: readonly CheckedChange[], admin: boolean) =>
  !admin && overall(checked) === 'yellow';

/** Two lists of changes are the same request when their content is the same. */
export const sameChanges = (a: readonly SupplierChange[], b: readonly SupplierChange[]) =>
  JSON.stringify(a) === JSON.stringify(b);

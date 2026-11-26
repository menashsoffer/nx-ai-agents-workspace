import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { changedFields } from './labels.ts';

/** The change log as plain sentences, grouped by day (spec section 4.4). Admins only. */
type Entry = NonNullable<SupplierDetail['audit']>[number];
export interface HistoryLine {
  key: string;
  text: string;
  time: string;
}
export interface HistoryDay {
  date: string;
  lines: HistoryLine[];
}

/** Singular and plural nouns for the records a change touches. */
const THINGS: Record<string, [string, string]> = {
  supplier_names: ['שם', 'שמות'],
  supplier_identifiers: ['מספר מזהה', 'מספרים מזהים'],
  supplier_contacts: ['פרט קשר', 'פרטי קשר'],
  memberships: ['רישום במאגר', 'רישומים במאגרים'],
};

function counted(table: string, count: number, verbs: [string, string]): string {
  const [one, many] = THINGS[table] ?? ['רשומה', 'רשומות'];
  return count === 1 ? `${verbs[0]} ${one}` : `${verbs[1]} ${String(count)} ${many}`;
}

/** One sentence for a group of changes made together to one kind of record. */
export function sentence(group: readonly Entry[]): string {
  const [first] = group;
  if (!first) return '';
  const { table_name: table, operation } = first;
  if (table === 'suppliers') {
    if (operation === 'INSERT') return 'הספק נוצר במערכת';
    if (operation === 'DELETE') return 'הספק נמחק';
    const fields = changedFields(first.changes);
    return fields ? `עודכנו פרטי הספק: ${fields}` : 'עודכנו פרטי הספק';
  }
  if (operation === 'INSERT') return counted(table, group.length, ['נוסף', 'נוספו']);
  if (operation === 'DELETE') return counted(table, group.length, ['הוסר', 'הוסרו']);
  return counted(table, group.length, ['עודכן', 'עודכנו']);
}

const DAY = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const TIME = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Changes in the same second, table and operation come from one load and read as one line. */
export function historyDays(audit: readonly Entry[]): HistoryDay[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of audit) {
    const key = `${entry.created_at.slice(0, 19)}|${entry.table_name}|${entry.operation}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const days = new Map<string, HistoryLine[]>();
  for (const [key, group] of groups) {
    const at = new Date(group[0]?.created_at ?? 0);
    const date = DAY.format(at).replaceAll('/', '.');
    const line = { key, text: sentence(group), time: TIME.format(at) };
    days.set(date, [...(days.get(date) ?? []), line]);
  }
  return [...days].map(([date, lines]) => ({ date, lines }));
}

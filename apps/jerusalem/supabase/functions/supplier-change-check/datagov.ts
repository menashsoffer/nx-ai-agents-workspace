// Registrar checks on data.gov.il beyond the company row (alignment review, stage B, 25.11):
// the nonprofit registrar's status, this year's proper-management certificate (ניהול תקין),
// and registrar events of the last 12 months (liens, liquidation). Each check reports whether
// it ran, so the site can say what was checked and what was not, and never "clean".
import { digits, getJson, text } from '../supplier-identifiers/sources.ts';
import type { Identifier } from './registry.ts';

const API = 'https://data.gov.il/api/3/action/datastore_search?resource_id=';
export const AMUTOT = `${API}be5b7935-3922-45d4-9638-08871b17ec95`;
export const PROPER = `${API}cb12ac14-7429-4268-bc03-460f48157858`;
export const EVENTS = `${API}28780ab5-3ef1-44c7-8377-da82c0aa6781`;

type Row = Record<string, unknown>;
export type CheckState = 'ok' | 'failed';

/** What data.gov.il said about one number, beside the registrar or GuideStar answer. */
export interface Extra {
  readonly id: string;
  readonly checks: Record<string, CheckState>;
  readonly details: Record<string, string>;
  /** The nonprofit registrar's own answer, used when GuideStar gave none. */
  readonly nonprofit?: { found: boolean; name: string | null; status: string | null };
}

async function records(url: string, filters: Row, fetcher: typeof fetch): Promise<Row[]> {
  const query = encodeURIComponent(JSON.stringify(filters));
  const body = (await getJson(fetcher, `${url}&limit=100&filters=${query}`)) as {
    success?: unknown;
    result?: { records?: unknown };
  };
  if (body.success !== true) throw new Error('data.gov.il lookup failed');
  const list = body.result?.records;
  return Array.isArray(list) ? (list as Row[]) : [];
}

/** dd/mm/yyyy as yyyy-mm-dd, or null. */
export function isoDay(value: unknown): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(text(value) ?? '');
  if (!match) return null;
  const [, day = '', month = '', year = ''] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** This year's certificate: signed, missing, or unclear when the rows disagree. */
export function properText(rows: Row[], year: number): string {
  const answers = new Set(rows.map((r) => text(r['האם יש אישור']) ?? 'ללא תשובה'));
  if (answers.size === 0) return `אין רשומה לשנת ${String(year)}`;
  if (answers.size > 1) return `לא ברור: ${[...answers].join(' / ')}`;
  return `${[...answers][0] ?? ''} (${String(year)})`;
}

/** Events of the last year, newest first, as "סוג בקשה dd.mm.yyyy". */
export function eventsText(rows: Row[], since: string): string {
  const recent = rows
    .map((r) => ({ kind: text(r['סוג בקשה']) ?? 'אירוע', day: isoDay(r['תאריך עדכון סטטוס']) }))
    .filter((e): e is { kind: string; day: string } => e.day !== null && e.day >= since)
    .sort((a, b) => b.day.localeCompare(a.day));
  return recent.map((e) => `${e.kind} ${e.day.split('-').reverse().join('.')}`).join('; ');
}

async function attempt<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

interface Today {
  readonly year: number;
  readonly since: string;
}

function nonprofitRow(rows: Row[], number: string) {
  const row = rows.find((r) => digits(r['מספר עמותה']) === number);
  if (!row) return { found: false, name: null, status: null };
  const name = text(row['שם עמותה בעברית'])?.replaceAll('~', '"') ?? null;
  return { found: true, name, status: text(row['סטטוס עמותה']) };
}

async function nonprofitPart(item: Identifier, today: Today, fetcher: typeof fetch) {
  const number = Number(item.value);
  const [registry, proper] = await Promise.all([
    attempt(() => records(AMUTOT, { 'מספר עמותה': number }, fetcher)),
    attempt(() =>
      records(PROPER, { 'מספר עמותה': String(number), 'שנת האישור': today.year }, fetcher),
    ),
  ]);
  const nonprofit = registry && nonprofitRow(registry, String(number));
  const details: Record<string, string> = {};
  if (proper) details['ניהול תקין'] = properText(proper, today.year);
  const checks: Record<string, CheckState> = {
    amutot: registry ? 'ok' : 'failed',
    proper: proper ? 'ok' : 'failed',
  };
  return { checks, details, ...(nonprofit ? { nonprofit } : {}) };
}

async function extraFor(item: Identifier, today: Today, fetcher: typeof fetch): Promise<Extra> {
  const events = await attempt(() =>
    records(EVENTS, { 'מספר תאגיד': Number(item.value) }, fetcher),
  );
  const base = item.scheme === 'nonprofit' ? await nonprofitPart(item, today, fetcher) : null;
  const details = { ...base?.details };
  const listed = events ? eventsText(events, today.since) : '';
  if (listed) details['אירועים ב-12 החודשים האחרונים'] = listed;
  return {
    id: item.id,
    checks: { ...base?.checks, events: events ? 'ok' : 'failed' },
    details,
    ...(base?.nonprofit ? { nonprofit: base.nonprofit } : {}),
  };
}

/** One extra answer per company or nonprofit number; a failed lookup is marked, not hidden. */
export function checkDatagov(items: Identifier[], fetcher: typeof fetch, now = new Date()) {
  const day = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
  const year = Number(day(now).slice(0, 4));
  const since = day(new Date(now.getTime() - 365 * 86_400_000));
  return Promise.all(items.map((item) => extraFor(item, { year, since }, fetcher)));
}

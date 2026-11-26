// Asks the registries about one number each: the Companies Registrar on data.gov.il for a
// company number, GuideStar for a nonprofit number. The search code of supplier-identifiers
// supplies the addresses, the GuideStar login and the answer helpers.
import {
  GUIDESTAR,
  REGISTRAR,
  digits,
  getJson,
  guidestarSession,
  text,
  type Credentials,
  type SourceState,
} from '../supplier-identifiers/sources.ts';

export interface Identifier {
  readonly id: string;
  readonly scheme: 'company' | 'nonprofit';
  readonly value: string;
}

/** What one registry said about one number. Not sent when the registry did not answer. */
export interface Checked {
  readonly id: string;
  readonly found: boolean;
  readonly name?: string | null;
  readonly status?: string | null;
  readonly details?: Record<string, unknown>;
}

export interface Answers {
  readonly results: Checked[];
  readonly state: SourceState;
}

type Row = Record<string, unknown>;

// Fields of the registrar's dataset worth keeping beside the name and status.
const REGISTRAR_DETAILS = [
  'סוג תאגיד',
  'תת סטטוס',
  'חברה ממשלתית',
  'מגבלות',
  'מפרה',
  'שנה אחרונה של דוח שנתי (שהוגש)',
];
const GUIDESTAR_FLAGS = ['isActive', 'hasNihulTakin', 'hasNihulTakinForNextYear', 'approval46'];

function pick(row: Row, keys: string[]): Record<string, string | boolean> {
  const details: Record<string, string | boolean> = {};
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'boolean') details[key] = value;
    else if (typeof value === 'number') details[key] = String(value);
    else if (text(value)) details[key] = text(value) ?? '';
  }
  return details;
}

async function registrarNumber(item: Identifier, fetcher: typeof fetch): Promise<Checked> {
  const filters = encodeURIComponent(JSON.stringify({ 'מספר חברה': Number(item.value) }));
  const body = (await getJson(fetcher, `${REGISTRAR}&limit=1&filters=${filters}`)) as {
    success?: unknown;
    result?: { records?: unknown };
  };
  if (body.success !== true) throw new Error('Registrar lookup failed');
  const answer = body.result?.records;
  const records = Array.isArray(answer) ? (answer as Row[]) : [];
  const row = records.find((r) => digits(r['מספר חברה']) === String(Number(item.value)));
  if (!row) return { id: item.id, found: false };
  return {
    id: item.id,
    found: true,
    name: text(row['שם חברה'])?.replaceAll('~', '"') ?? null,
    status: text(row['סטטוס חברה']),
    details: pick(row, REGISTRAR_DETAILS),
  };
}

function guidestarStatus(row: Row): string | null {
  const status = text(row.malkarStatus);
  // isActive false with a status that does not say so still counts as inactive.
  return row.isActive === false ? `${status ?? 'ללא סטטוס'} - לא פעיל` : status;
}

async function guidestarNumber(item: Identifier, session: string, fetcher: typeof fetch) {
  const url = `${GUIDESTAR}/organizations/${encodeURIComponent(item.value)}?fullObject=true`;
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${session}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return { id: item.id, found: false };
  if (!response.ok) throw new Error(`Answered ${String(response.status)}`);
  const body: unknown = await response.json();
  const row = (Array.isArray(body) ? body[0] : body) as Row | null | undefined;
  if (!row || typeof row !== 'object' || row.success === false) {
    return { id: item.id, found: false };
  }
  const details = pick(row, [...GUIDESTAR_FLAGS, 'malkarType', 'urlGuidestar']);
  return { id: item.id, found: true, name: text(row.name), status: guidestarStatus(row), details };
}

async function settle(work: () => Promise<Checked[]>): Promise<Answers> {
  try {
    return { results: await work(), state: 'ok' };
  } catch {
    return { results: [], state: 'failed' };
  }
}

export function checkRegistrar(items: Identifier[], fetcher: typeof fetch): Promise<Answers> {
  const companies = items.filter((item) => item.scheme === 'company');
  return settle(() => Promise.all(companies.map((item) => registrarNumber(item, fetcher))));
}

export async function checkGuidestar(
  items: Identifier[],
  credentials: Credentials | null,
  fetcher: typeof fetch,
): Promise<Answers> {
  const nonprofits = items.filter((item) => item.scheme === 'nonprofit');
  if (nonprofits.length === 0) return { results: [], state: 'ok' };
  if (!credentials) return { results: [], state: 'not_configured' };
  return settle(async () => {
    const session = await guidestarSession(credentials, fetcher);
    return Promise.all(nonprofits.map((item) => guidestarNumber(item, session, fetcher)));
  });
}

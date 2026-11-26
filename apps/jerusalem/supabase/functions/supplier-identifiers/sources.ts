// The two public sources of supplier numbers. Each search returns candidates only:
// the Companies Registrar on data.gov.il (no key) and GuideStar for nonprofits
// and public-benefit companies (an account kept as a function secret).

export interface Found {
  readonly scheme: 'company' | 'nonprofit';
  readonly value: string;
  readonly source: 'companies_registrar' | 'guidestar';
  readonly registrar_name: string;
  readonly registrar_status: string | null;
  readonly searched_name: string;
}

export interface Credentials {
  readonly username: string;
  readonly password: string;
}

/** The GuideStar account, kept as function secrets; null when it is not set. */
export function guidestarCredentials(read: (name: string) => string | undefined) {
  const username = read('GUIDESTAR_USERNAME');
  const password = read('GUIDESTAR_PASSWORD');
  return username && password ? { username, password } : null;
}

/** 'failed' keeps partial results usable when one source is down. */
export type SourceState = 'ok' | 'failed' | 'not_configured';

export interface Search {
  readonly found: Found[];
  readonly state: SourceState;
}

const TIMEOUT_MS = 10000;
const PER_NAME = 5;
export const REGISTRAR =
  'https://data.gov.il/api/3/action/datastore_search?resource_id=f004176c-b85f-4542-8901-7b3176f9a054';
export const GUIDESTAR = 'https://www.guidestar.org.il/services/apexrest/api';
const NUMBER = /^[0-9]{5,9}$/u;

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error('Unexpected answer');
  return value.filter((row): row is Row => row !== null && typeof row === 'object');
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export async function getJson(fetcher: typeof fetch, url: string, init: RequestInit = {}) {
  const response = await fetcher(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Answered ${String(response.status)}`);
  return await response.json();
}

/** A registrar number arrives as a JSON number, a GuideStar one as a string. */
export function digits(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}

function registrarRow(row: Row, searched: string): Found | null {
  const value = digits(row['מספר חברה']);
  const name = text(row['שם חברה']);
  if (!NUMBER.test(value) || !name) return null;
  return {
    scheme: 'company',
    value,
    source: 'companies_registrar',
    // The registrar writes the quote of בע"מ as ~.
    registrar_name: name.replaceAll('~', '"'),
    registrar_status: text(row['סטטוס חברה']),
    searched_name: searched,
  };
}

async function registrarName(name: string, fetcher: typeof fetch): Promise<Found[]> {
  const url = `${REGISTRAR}&limit=${String(PER_NAME)}&q=${encodeURIComponent(name)}`;
  const body = (await getJson(fetcher, url)) as {
    success?: unknown;
    result?: { records?: unknown };
  };
  if (body.success !== true) throw new Error('Registrar search failed');
  return rows(body.result?.records)
    .map((row) => registrarRow(row, name))
    .filter((found) => found !== null);
}

const SCHEMES: Record<string, Found['scheme']> = {
  עמותה: 'nonprofit',
  'חל"צ': 'company',
  'חל״צ': 'company',
};

function guidestarRow(row: Row, searched: string): Found | null {
  const scheme = SCHEMES[String(row.malkarType)];
  const value = digits(row.regNum);
  const name = text(row.name);
  if (!scheme || !NUMBER.test(value) || !name) return null;
  return {
    scheme,
    value,
    source: 'guidestar',
    registrar_name: name,
    registrar_status: text(row.malkarStatus),
    searched_name: searched,
  };
}

export async function guidestarSession(credentials: Credentials, fetcher: typeof fetch) {
  const body = (await getJson(fetcher, `${GUIDESTAR}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })) as { sessionId?: unknown };
  const session = text(body.sessionId);
  if (!session) throw new Error('GuideStar login failed');
  return session;
}

async function guidestarName(name: string, session: string, fetcher: typeof fetch) {
  // The filter syntax uses these characters, so such a name cannot be searched.
  if (/[;=<>]/u.test(name)) return [];
  const url = `${GUIDESTAR}/organizations?filter=${encodeURIComponent(`name=${name}`)}`;
  const body = await getJson(fetcher, url, { headers: { Authorization: `Bearer ${session}` } });
  return rows(body)
    .slice(0, PER_NAME * 4)
    .map((row) => guidestarRow(row, name))
    .filter((found) => found !== null)
    .slice(0, PER_NAME);
}

async function settle(work: () => Promise<Found[][]>): Promise<Search> {
  try {
    return { found: (await work()).flat(), state: 'ok' };
  } catch {
    return { found: [], state: 'failed' };
  }
}

export function searchRegistrar(names: string[], fetcher: typeof fetch): Promise<Search> {
  return settle(() => Promise.all(names.map((name) => registrarName(name, fetcher))));
}

export async function searchGuidestar(
  names: string[],
  credentials: Credentials | null,
  fetcher: typeof fetch,
): Promise<Search> {
  if (!credentials) return { found: [], state: 'not_configured' };
  return settle(async () => {
    const session = await guidestarSession(credentials, fetcher);
    return Promise.all(names.map((name) => guidestarName(name, session, fetcher)));
  });
}

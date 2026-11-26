// One address against OpenStreetMap (Nominatim, no key). Its usage policy asks for at
// most one request per second and an identifying User-Agent; the caller spaces the
// calls. Supplier spec 4.6: a street-level hit counts as found, a town-level hit as
// approximate. Photon (photon.ts) is the fallback when Nominatim refuses us.

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
export const USER_AGENT = 'supplier-registry-address-check/1.0';
const TIMEOUT_MS = 8000;
/** Nominatim's place_rank: 26 is a street, 30 a house. A town is 16. */
const STREET_RANK = 26;

export type CheckResult = 'found' | 'approximate' | 'not_found' | 'failed';

export interface Checked {
  readonly result: CheckResult;
  readonly map_label: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** The map service refused us (rate limit or block): switch service or stop. */
export class Refused extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Map refused with ${String(status)}`);
    this.status = status;
  }
}

/** One free map service: a name for the run log and a search for one query. */
export interface Provider {
  readonly name: string;
  readonly search: (query: string, fetcher: typeof fetch) => Promise<Checked>;
}

export const NOTHING: Checked = {
  result: 'not_found',
  map_label: null,
  latitude: null,
  longitude: null,
};

/** Removes what confuses the search: notes in brackets, quotes, postal codes, "רח'". */
export function cleanAddress(value: string): string {
  const first = value.split(/\s\/\s/u)[0] ?? value;
  return first
    .replace(/\([^)]*\)/gu, ' ')
    .replace(/["״]/gu, ' ')
    .replace(/(^|[\s,])(רח'|רח׳|רחוב)\s/gu, '$1')
    .replace(/\b\d{5,7}\b/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s*,\s*/gu, ', ')
    .replace(/^[\s,]+|[\s,]+$/gu, '');
}

/** The cleaned address, then street and town alone when there are middle parts. */
export function queries(value: string): string[] {
  const cleaned = cleanAddress(value);
  const parts = cleaned.split(', ').filter((part) => part !== '');
  const short = parts.length > 2 ? `${parts[0] ?? ''}, ${parts.at(-1) ?? ''}` : null;
  return [cleaned, ...(short ? [short] : [])].filter((query) => query !== '');
}

export function searchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    countrycodes: 'il',
    limit: '1',
    'accept-language': 'he',
  });
  return `${NOMINATIM}?${params.toString()}`;
}

export function numberOf(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Reads Nominatim's first hit. */
export function classify(answer: unknown): Checked {
  const hit: unknown = Array.isArray(answer) ? answer[0] : null;
  if (hit === null || typeof hit !== 'object') return NOTHING;
  const row = hit as Record<string, unknown>;
  const rank = typeof row.place_rank === 'number' ? row.place_rank : 0;
  return {
    result: rank >= STREET_RANK ? 'found' : 'approximate',
    map_label: typeof row.display_name === 'string' ? row.display_name.slice(0, 500) : null,
    latitude: numberOf(row.lat),
    longitude: numberOf(row.lon),
  };
}

/** GETs one map URL; a 403 or 429 is a refusal, any other error fails this address. */
export async function mapJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 429 || response.status === 403) throw new Refused(response.status);
  if (!response.ok) throw new Error(`Map answered ${String(response.status)}`);
  return response.json();
}

export const nominatim: Provider = {
  name: 'nominatim',
  search: async (query, fetcher) => classify(await mapJson(searchUrl(query), fetcher)),
};

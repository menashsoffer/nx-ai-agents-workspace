// The fallback map service: Photon (photon.komoot.io), an OpenStreetMap search with no
// key, used when Nominatim refuses requests from the Edge Function's network. Results
// are limited to Israel's bounding box. A house or street hit counts as found.

import { mapJson, NOTHING, numberOf, type Checked, type Provider } from './geocode.ts';

export const PHOTON = 'https://photon.komoot.io/api/';
const ISRAEL_BBOX = '34.2,29.4,35.9,33.4';
const STREET_TYPES = new Set(['house', 'street']);

export function photonUrl(query: string): string {
  const params = new URLSearchParams({ q: query, limit: '1', bbox: ISRAEL_BBOX });
  return `${PHOTON}?${params.toString()}`;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function label(props: Record<string, unknown>): string | null {
  const street = [textOf(props.street) ?? textOf(props.name), textOf(props.housenumber)];
  const parts = [street.filter(Boolean).join(' '), textOf(props.city)].filter(Boolean);
  return parts.length ? parts.join(', ').slice(0, 500) : null;
}

/** GeoJSON points are [longitude, latitude]. */
function coordinates(geometry: unknown): { latitude: number | null; longitude: number | null } {
  const point = (geometry as { coordinates?: unknown } | undefined)?.coordinates;
  const [lon, lat] = Array.isArray(point) ? (point as unknown[]) : [];
  return { latitude: numberOf(String(lat)), longitude: numberOf(String(lon)) };
}

/** Reads Photon's first GeoJSON feature. */
export function classifyPhoton(answer: unknown): Checked {
  const features = (answer as { features?: unknown } | null)?.features;
  const feature: unknown = Array.isArray(features) ? features[0] : null;
  if (feature === null || typeof feature !== 'object') return NOTHING;
  const { properties, geometry } = feature as { properties?: unknown; geometry?: unknown };
  const props = (properties ?? {}) as Record<string, unknown>;
  const street = STREET_TYPES.has(String(props.type)) || textOf(props.housenumber) !== null;
  return {
    result: street ? 'found' : 'approximate',
    map_label: label(props),
    ...coordinates(geometry),
  };
}

export const photon: Provider = {
  name: 'photon',
  search: async (query, fetcher) => classifyPhoton(await mapJson(photonUrl(query), fetcher)),
};

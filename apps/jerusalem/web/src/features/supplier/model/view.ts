import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { splitFields } from '../../../lib/fields.ts';
import { ENTITY_KINDS, REVIEW } from './labels.ts';

/** What the supplier screen shows, worked out from the detail record (spec sections 4.1-4.3). */
export type Tone = 'success' | 'warning' | 'danger' | 'neutral';
export interface Badge {
  tone: Tone;
  text: string;
}

const SHORT_ID: Record<string, string> = {
  company: 'ח.פ.',
  nonprofit: 'מספר עמותה',
  vat_dealer: 'עוסק מורשה',
};
const REVIEW_TONE: Record<string, Tone> = {
  verified: 'success',
  needs_review: 'warning',
  rejected: 'danger',
  removed: 'danger',
};

/** Letters and digits only, without a trailing company suffix, so near-copies compare equal. */
export function nameKey(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/(בעמ|לטד|ltd)$/iu, '')
    .toLowerCase();
}

/** Other names the supplier is known by, each once, never repeating the display name. */
export function alsoKnownAs(displayName: string, names: readonly { name: string }[]): string[] {
  const seen = new Set([nameKey(displayName)]);
  const result: string[] = [];
  for (const { name } of names) {
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(name.trim());
  }
  return result;
}

/** Activity only; verification is the mark beside the name. */
export function headerBadges(supplier: SupplierDetail['supplier']): Badge[] {
  return supplier.status === 'inactive'
    ? [{ tone: 'danger', text: 'לא פעיל' }]
    : [{ tone: 'success', text: 'פעיל' }];
}

export interface VerificationMark {
  verified: boolean;
  label: string;
}

export function verificationMark(supplier: SupplierDetail['supplier']): VerificationMark {
  return supplier.review_status === 'verified'
    ? { verified: true, label: 'ספק מאומת' }
    : { verified: false, label: 'ממתין לאימות' };
}

/** The city is the last part of an address, without a postal code. */
export function cityOf(address: string): string | null {
  const last = address.split(',').at(-1)?.replace(/\d+/g, '').trim();
  return last && last !== address.trim() ? last : null;
}

/** Entity kind, main identifier, city and registry count; missing parts are left out. */
export function summaryParts(data: SupplierDetail): string[] {
  const kind = ENTITY_KINDS[data.supplier.entity_kind];
  const id = data.identifiers.find((item) => SHORT_ID[item.scheme]);
  const address = data.contacts.find((item) => item.kind === 'address');
  const city = address ? cityOf(address.value) : null;
  const registries = new Set(data.memberships.map((item) => item.registry_version_id)).size;
  return [
    kind && data.supplier.entity_kind !== 'unknown' ? kind : null,
    id ? `${SHORT_ID[id.scheme] ?? ''} ${id.value}` : null,
    city,
    registries ? `רשום ב-${registries === 1 ? 'מאגר אחד' : `${String(registries)} מאגרים`}` : null,
  ].filter((part): part is string => part !== null);
}

/** One plain sentence about verification, or null when everything shown is verified. */
export function verificationNote(data: SupplierDetail): string | null {
  const ids = data.identifiers.filter((item) => SHORT_ID[item.scheme]);
  if (!ids.length) return 'אין לספק מספר מזהה מאומת במערכת. לפני התקשרות יש לוודא את פרטיו.';
  if (ids.some((item) => item.review_status !== 'verified')) {
    return 'המספר המזהה ופרטי הרישום עדיין לא אומתו מול הרשם. לפני התקשרות יש לוודא אותם.';
  }
  return data.supplier.review_status === 'verified'
    ? null
    : 'פרטי הספק עדיין לא אומתו. לפני התקשרות יש לוודא אותם.';
}

/** DD.MM.YYYY for display; dates stay YYYY-MM-DD everywhere else. */
export function displayDate(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
}

export interface ListingView {
  key: string;
  registry: string;
  badge: Badge;
  fields: string[];
  validity: string;
  engagement: string | null;
}

function validityText(from: string | null, until: string | null, today: string): string {
  if (!from && !until) return 'תוקף הרישום: לא ידוע';
  if (until && until < today) return `תוקף הרישום פג ב-${displayDate(until)}`;
  const start = from ? displayDate(from) : 'לא ידוע';
  return `תוקף הרישום: ${start} עד ${until ? displayDate(until) : 'לא ידוע'}`;
}

type Member = SupplierDetail['memberships'][number];
type Version = SupplierDetail['versions'][number] | undefined;

function listingBadge(item: Member, expired: boolean): Badge {
  if (expired) return { tone: 'neutral', text: 'פג תוקף' };
  return {
    tone: REVIEW_TONE[item.review_status] ?? 'neutral',
    text: REVIEW[item.review_status] ?? 'מצב לא ידוע',
  };
}

/** A listing's own dates win; otherwise the registry version's validity applies. */
function datesOf(item: Member, version: Version) {
  return {
    from: item.registered_from ?? version?.valid_from ?? null,
    until: item.registered_until ?? version?.valid_until ?? null,
  };
}

function registryName(data: SupplierDetail, version: Version): string {
  return data.registries.find((value) => value.id === version?.registry_id)?.name ?? 'מאגר לא זמין';
}

function listing(data: SupplierDetail, item: Member, today: string): Omit<ListingView, 'key'> {
  const version = data.versions.find((value) => value.id === item.registry_version_id);
  const field = data.fields.find((value) => value.id === item.registry_field_id);
  const { from, until } = datesOf(item, version);
  const started = item.engagement_started_on;
  return {
    registry: registryName(data, version),
    badge: listingBadge(item, until !== null && until < today),
    fields: splitFields(field?.source_text ?? '') ?? [],
    validity: validityText(from, until, today),
    engagement: started ? `תחילת התקשרות: ${displayDate(started)}` : null,
  };
}

/** One entry per registry version; registry names carry their year, so the newest sorts first. */
export function listings(data: SupplierDetail, today: string): ListingView[] {
  const byVersion = new Map<string, ListingView>();
  for (const item of data.memberships) {
    const view = listing(data, item, today);
    const found = byVersion.get(item.registry_version_id);
    if (found) found.fields = [...new Set([...found.fields, ...view.fields])];
    else byVersion.set(item.registry_version_id, { key: item.registry_version_id, ...view });
  }
  return [...byVersion.values()].sort((a, b) =>
    b.registry.localeCompare(a.registry, 'he', { numeric: true }),
  );
}

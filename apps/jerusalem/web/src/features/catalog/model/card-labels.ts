import { type Membership, type Supplier, validity } from '../../../catalog-model.ts';
import { splitFields } from '../../../lib/fields.ts';

export function inactiveLine(inactive: NonNullable<Supplier['inactive']>): string {
  const parts = [`סיבה: ${inactive.reason}`];
  if (inactive.source) parts.push(`מקור: ${inactive.source}`);
  if (inactive.changedOn) parts.push(`מתאריך ${inactive.changedOn}`);
  return parts.join(' · ');
}

/**
 * The card names what the supplier does, not where each listing came from: the field of every
 * current listing (the registry when a listing has no field), each once. Expired listings count
 * only when nothing current is left. Sources and pages stay on the supplier screen.
 */
export function supplierFields(memberships: readonly Membership[], today: string): string[] {
  const current = memberships.filter((member) => validity(member, today) !== 'expired');
  const shown = current.length ? current : memberships;
  return [...new Set(shown.flatMap((member) => splitFields(member.field) ?? [member.registry]))];
}

export type VenueIcon = 'seats' | 'size' | 'stage' | 'screen' | 'sound' | 'lighting';
export interface VenueFact {
  icon: VenueIcon | null;
  text: string;
}
const VENUE_LABELS: [VenueIcon, keyof NonNullable<Supplier['venue']>, string][] = [
  ['seats', 'capacity_text', 'קיבולת'],
  ['size', 'hall_size', 'גודל אולם'],
  ['stage', 'stage_size', 'במה'],
  ['screen', 'screen', 'מסך'],
  ['sound', 'sound', 'הגברה'],
  ['lighting', 'lighting', 'תאורה'],
];

/** Right-to-left cells can store "1,000" as "000,1": a last group shorter than three digits. */
const REVERSED_THOUSANDS = /\d{3}(?:,\d{3})*,\d{1,2}(?!\d)/;

function capacityText(venue: NonNullable<Supplier['venue']>): string | null {
  const text = venue.capacity_text;
  if (text === null || venue.capacity === null || !REVERSED_THOUSANDS.test(text)) return text;
  return text.replace(REVERSED_THOUSANDS, venue.capacity.toLocaleString('en-US'));
}

/** Each published hall detail with its own text label; empty fields are left out. */
export function venueFacts(venue: Supplier['venue']): VenueFact[] {
  if (!venue) return [];
  const shown = { ...venue, capacity_text: capacityText(venue) };
  const facts = VENUE_LABELS.flatMap(([icon, key, label]): VenueFact[] => {
    const value = shown[key];
    return value === null || value === '' ? [] : [{ icon, text: `${label}: ${String(value)}` }];
  });
  return venue.survey_year === null || facts.length === 0
    ? facts
    : [...facts, { icon: null, text: `לפי מאגר ${String(venue.survey_year)}` }];
}

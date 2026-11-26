import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import type { IconName } from '../../../ui/icon.tsx';
import { CONTACT_KINDS } from './labels.ts';

type Contact = SupplierDetail['contacts'][number];

/**
 * Menash, 22.11: contact details in a fixed order (email, address, phones, mobiles), each
 * phone on its own line with an icon. A mobile is an Israeli number that starts with 05.
 */
const GROUPS = ['email', 'address', 'phone', 'mobile', 'website', 'contact_person'] as const;
export type ContactGroup = (typeof GROUPS)[number] | 'other';

/** 'mobile' is drawn by KindIcon, which keeps its path out of the shared icon set. */
const ICONS: Record<ContactGroup, IconName | 'mobile'> = {
  email: 'mail',
  address: 'pin',
  phone: 'phone',
  mobile: 'mobile',
  website: 'globe',
  contact_person: 'person',
  other: 'person',
};

/** A number that starts with 05 (or +972 5) after its separators are removed. */
export function isMobile(value: string): boolean {
  const digits = value.replace(/[^\d+]/g, '');
  return /^(?:05|\+?9725)\d{8}$/.test(digits);
}

export function contactGroup(kind: string, value: string): ContactGroup {
  if (kind === 'phone') return isMobile(value) ? 'mobile' : 'phone';
  return (GROUPS as readonly string[]).includes(kind) ? (kind as ContactGroup) : 'other';
}

export function contactLabel(kind: string, value: string): string {
  if (contactGroup(kind, value) === 'mobile') return 'טלפון נייד';
  return CONTACT_KINDS[kind] ?? 'פרט קשר';
}

export function contactIcon(kind: string, value: string): IconName | 'mobile' {
  return ICONS[contactGroup(kind, value)];
}

function rank(item: Pick<Contact, 'kind' | 'value'>): number {
  const index = GROUPS.indexOf(contactGroup(item.kind, item.value) as (typeof GROUPS)[number]);
  return index === -1 ? GROUPS.length : index;
}

/** A stable sort: within a group the database order stays. */
export function sortContacts<T extends Pick<Contact, 'kind' | 'value'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/**
 * Some records hold several numbers in one value ("054-2244973 054-5990250"). Each number is
 * shown on its own line. A value that does not split cleanly into phone numbers stays whole.
 */
export function splitPhones(value: string): string[] {
  const parts = value
    .split(/[,;/|\s]+(?=[+\d])/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [value];
  const numbers = parts.every((part) => /^\+?[\d-]{7,}$/.test(part.replace(/[()\s]/g, '')));
  return numbers ? parts : [value];
}

import { safeSourceUrl } from './labels.ts';

const MAPS = 'https://www.google.com/maps/search/?api=1&query=';

/** The link a contact value opens: mail, phone, map search or website. Null when none fits. */
export function contactLink(kind: string, value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? `mailto:${text}` : null;
  if (kind === 'phone') {
    const digits = text.replace(/[^\d+]/g, '');
    return digits.length >= 7 ? `tel:${digits}` : null;
  }
  if (kind === 'address') return MAPS + encodeURIComponent(text);
  if (kind === 'website')
    return safeSourceUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  return null;
}

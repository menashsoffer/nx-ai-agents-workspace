import type { SupplierDetail } from '../../../data/supplier-detail.ts';

/** What the request page needs about each picked supplier. No identifiers, by design. */
export interface PickedSupplier {
  id: string;
  name: string;
  inactive: boolean;
  emails: string[];
  phones: string[];
  lastApproached: string | null;
}

function values(detail: SupplierDetail, kind: string): string[] {
  const found = detail.contacts.filter((c) => c.kind === kind && c.is_valid !== false);
  return [...new Set(found.map((c) => c.value.trim()).filter(Boolean))];
}

export function pickedSupplier(detail: SupplierDetail, lastOn: string | null): PickedSupplier {
  return {
    id: detail.supplier.id,
    name: detail.supplier.display_name,
    inactive: detail.supplier.status === 'inactive',
    emails: values(detail, 'email'),
    phones: values(detail, 'phone'),
    lastApproached: lastOn,
  };
}

/** One address per supplier for BCC, separated by `;`, and who has none. */
export function bccLine(suppliers: readonly PickedSupplier[]) {
  const withEmail = suppliers.filter((s) => s.emails.length > 0 && !s.inactive);
  const missing = suppliers.filter((s) => s.emails.length === 0 && !s.inactive).map((s) => s.name);
  return { text: withEmail.map((s) => s.emails[0]).join(';'), count: withEmail.length, missing };
}

export function bccMessage(bcc: ReturnType<typeof bccLine>): string {
  const copied = `הועתקו ${String(bcc.count)} כתובות דוא״ל.`;
  return bcc.missing.length ? `${copied} אין דוא״ל במאגר עבור: ${bcc.missing.join(', ')}.` : copied;
}

/**
 * A link that reopens the same list. The site uses hash routes, so the route goes after `#`.
 * It works only for signed-in users with access.
 */
export function shareLink(page: string, suppliers: readonly PickedSupplier[]): string {
  const url = new URL(page);
  const ids = new URLSearchParams({ suppliers: suppliers.map((s) => s.id).join(',') });
  url.hash = `/engagement?${ids.toString()}`;
  return url.toString();
}

export function approachLabel(date: string | null): string {
  if (!date) return 'לא נרשמה פנייה קודמת';
  const [year, month, day] = date.split('-');
  return `פנייה אחרונה: ${day ?? ''}.${month ?? ''}.${year ?? ''}`;
}

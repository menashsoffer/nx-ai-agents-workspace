// What the supplier area shows and checks, without the network (supplier-portal-spec-he.md 5-6).
import { validCheckDigit } from '../../../lib/rules/israeli-id.ts';
import { RULE_MESSAGES } from '../../../lib/rules/messages.ts';
import { CONTACT_RULES, nameProblem, type ContactKind } from '../../../lib/rules/supplier.ts';
import { textProblem } from '../../../lib/rules/text.ts';
import type { PortalAccount, PortalMe } from '../api/portal.ts';

export type Scheme = 'company' | 'nonprofit';

/** The scheme a 9-digit number belongs to, or a sentence on what is wrong with it. */
export function readIdentifier(raw: string): { scheme: Scheme; value: string } | { error: string } {
  const value = raw.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(value)) return { error: 'יש להקליד את כל 9 הספרות, בלי אותיות.' };
  if (!validCheckDigit(value)) return { error: 'המספר לא תקין. בדקו שאין ספרה שגויה.' };
  return { scheme: value.startsWith('58') ? 'nonprofit' : 'company', value };
}

/** A proof file is a PDF or an image of up to 10MB (bucket limits, spec 7.4). */
export function proofProblem(
  file: Pick<File, 'size' | 'type'> | null,
  types: readonly string[],
  maxBytes: number,
): string | null {
  if (!file || file.size === 0) return 'יש לצרף קובץ.';
  if (!types.includes(file.type)) return 'אפשר לצרף רק PDF, JPEG או PNG.';
  if (file.size > maxBytes) return 'הקובץ גדול מ-10MB. צרפו קובץ קטן יותר.';
  return null;
}

export type AreaStep = 'person' | 'invites' | 'link' | 'file';

/** Which screen a signed-in person sees first. */
export function areaStep(me: PortalMe): AreaStep {
  if (!me.person) return 'person';
  if (me.accounts.some((a) => a.status === 'active')) return 'file';
  if (me.invites.length > 0) return 'invites';
  return 'link';
}

export const activeAccounts = (me: PortalMe): PortalAccount[] =>
  me.accounts.filter((a) => a.status === 'active');

/** Links that are not active, newest first, with one sentence each. */
export function accountNote(account: PortalAccount): string {
  if (account.status === 'pending') return 'הבקשה ממתינה לאישור העירייה.';
  const why = account.decision_note ? ` הסיבה: ${account.decision_note}` : '';
  if (account.status === 'rejected') return `הבקשה נדחתה.${why}`;
  if (account.status === 'revoked') return `השיוך בוטל בידי העירייה.${why}`;
  return '';
}

export const SCHEME_LABELS: Record<string, string> = {
  company: 'ח"פ',
  nonprofit: 'מספר עמותה',
  vat_dealer: 'מספר עוסק',
  personal_id: 'ת"ז',
};

export const CONTACT_LABELS: Record<string, string> = {
  email: 'דוא"ל',
  phone: 'טלפון',
  address: 'כתובת',
  website: 'אתר',
  contact_person: 'איש קשר',
};

/** The calendar day `days` after `day` (both YYYY-MM-DD). */
export function plusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "בתוקף עד", "הסתיים", or "מסתיים בקרוב" for a registration end date. */
export function validity(until: string | null, today: string): 'open' | 'soon' | 'ended' | 'valid' {
  if (!until) return 'open';
  if (until < today) return 'ended';
  return until <= plusDays(today, 60) ? 'soon' : 'valid';
}

export interface ProposalFields {
  kind: 'rename' | 'contact';
  contact_kind?: string;
  value: string;
  reason: string;
}

const TEXT_REASON = { min: 3, max: 500, letters: 2 };

/** The same rules the database runs, as one sentence, or null when the fix can be sent. */
export function proposalProblem(fields: ProposalFields): string | null {
  const value = fields.value.trim();
  const rule =
    fields.kind === 'rename'
      ? nameProblem(value)
      : fields.contact_kind && fields.contact_kind in CONTACT_RULES
        ? CONTACT_RULES[fields.contact_kind as ContactKind](value)
        : 'bad_choice';
  if (rule) return RULE_MESSAGES[rule];
  const reason = fields.reason.trim();
  if ((fields.kind === 'rename' || reason) && textProblem(reason, TEXT_REASON))
    return 'צריך לכתוב סיבה לשינוי, לפחות 3 תווים.';
  return null;
}
export const PROPOSAL_STATUS: Record<string, string> = {
  pending: 'ממתין לבדיקה',
  applied: 'עודכן',
  approved: 'אושר ועודכן',
  rejected: 'נדחה',
  cancelled: 'בוטל',
};

/** What a proposal is about, for its line in "הבקשות שלי". */
export function proposalLabel(kind: string, contactKind: string | null): string {
  if (kind === 'rename') return 'שם הספק';
  if (kind === 'entity_kind') return 'סוג הספק';
  return CONTACT_LABELS[contactKind ?? ''] ?? 'פרט קשר';
}

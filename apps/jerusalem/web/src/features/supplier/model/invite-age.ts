import { dayOf } from '../../../lib/dates.ts';

/** One staff invite to the supplier area, as the supplier_invites table returns it. */
export interface Invite {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

/** How far along an invite is, in words and in whole days for the progress bar. */
export interface InviteAge {
  state: 'open' | 'expired' | 'accepted';
  /** "נשלחה ב-19.11.2026, לפני 3 ימים" */
  sent: string;
  /** "בתוקף: נשארו עוד 10 ימים, עד 03.12.2026", "פג תוקף ב-…" or "התקבלה ב-…" */
  status: string;
  /** Days since it was sent and the invite's full length, for <progress>. */
  elapsed: number;
  length: number;
}

const DAY = 86_400_000;

/** "יום אחד", "יומיים", "5 ימים" */
export function days(count: number): string {
  if (count === 1) return 'יום אחד';
  if (count === 2) return 'יומיים';
  return `${String(count)} ימים`;
}

function sentText(created: string, daysAgo: number): string {
  const ago = daysAgo === 0 ? 'לפני פחות מיום' : `לפני ${days(daysAgo)}`;
  return `נשלחה ב-${dayOf(created)}, ${ago}`;
}

function openText(left: number, expires: string): string {
  if (left <= 0) return `פג בעוד פחות מיום, ב-${dayOf(expires)}`;
  const verb = left === 1 ? 'נשאר' : 'נשארו';
  return `בתוקף: ${verb} עוד ${days(left)}, עד ${dayOf(expires)}`;
}

/**
 * Whole days between two instants. An invite lasts a fixed 14 x 24 hours from the moment it
 * was saved (database default), so plain instant arithmetic is exact here; it keeps Temporal,
 * which Safari lacks, and its polyfill out of the bundle.
 */
function wholeDays(from: number, to: number): number {
  return Math.floor((to - from) / DAY);
}

/** Where an invite stands at `now`: still open, past its date, or already used. */
export function inviteAge(invite: Invite, now: Date): InviteAge {
  const sent = Date.parse(invite.created_at);
  const expires = Date.parse(invite.expires_at);
  const length = Math.max(1, Math.round((expires - sent) / DAY));
  const ago = Math.max(0, wholeDays(sent, now.getTime()));
  const base = { sent: sentText(invite.created_at, ago), elapsed: Math.min(length, ago), length };
  if (invite.accepted_at) {
    return { ...base, state: 'accepted', status: `התקבלה ב-${dayOf(invite.accepted_at)}` };
  }
  if (expires <= now.getTime()) {
    return { ...base, state: 'expired', status: `פג תוקף ב-${dayOf(invite.expires_at)}` };
  }
  const left = wholeDays(now.getTime(), expires);
  return { ...base, state: 'open', status: openText(left, invite.expires_at) };
}

/** The words staff paste to the supplier: version 1 sends no email itself. */
export function inviteMessage(invite: Invite, link: string): string {
  return [
    'שלום,',
    'הוזמנתם לאזור האישי של הספקים בעיריית ירושלים.',
    `היכנסו בקישור ${link} עם הדוא"ל ${invite.email}.`,
    `ההזמנה בתוקף עד ${dayOf(invite.expires_at)}.`,
  ].join('\n');
}

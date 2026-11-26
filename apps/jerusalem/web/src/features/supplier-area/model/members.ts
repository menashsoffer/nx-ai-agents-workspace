// Rules of "המשתמשים שלנו" that the screen checks before it asks the database.
import type { Member, Members } from '../api/members.ts';

/** The same shape the database accepts (portal_invite_member). */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const ROLE_LABELS = { owner: 'מורשה', member: 'עובד' } as const;

/** Why the address cannot be invited, or '' when it can. */
export function inviteProblem(raw: string, list: Members): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) {
    return 'כתבו כתובת דוא"ל מלאה, כמו name@example.co.il.';
  }
  if (list.members.some((m) => m.email?.toLowerCase() === email)) {
    return 'האדם הזה כבר משויך לספק.';
  }
  return '';
}

/** The last active owner stays, so the supplier never loses its people (spec 6.8). */
export function canRemove(member: Member, list: Members): boolean {
  if (member.role !== 'owner') return true;
  return list.members.filter((m) => m.role === 'owner').length > 1;
}

export function memberName(member: Member): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return name === '' ? (member.email ?? 'בלי שם') : name;
}

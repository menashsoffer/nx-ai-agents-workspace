import type { Access } from '../../../data/access.ts';
export const ACCESS_MESSAGES: Record<Access['state'], string> = {
  pending: 'הבקשה ממתינה לאישור מנהל.',
  blocked: 'הגישה חסומה. יש לפנות למנהל המערכת.',
  rejected: 'בקשת הגישה נדחתה. יש לפנות למנהל המערכת.',
  unregistered: 'נדרשת בקשת גישה. יש לפנות למנהל המערכת.',
  active: 'ההתחברות פעילה.',
};
export { ROLE_LABELS } from '../../../data/access-change-labels.ts';

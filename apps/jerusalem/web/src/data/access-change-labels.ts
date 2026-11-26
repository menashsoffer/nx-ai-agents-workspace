// How an access change request reads on screen (screens-spec 4.1).
import type { Role } from './access.ts';
import type { ChangeRequest } from './access-changes.ts';

export const ROLE_LABELS: Record<Role, string> = {
  viewer: 'צופה',
  editor: 'עורך',
  unit_manager: 'מנהל יחידה',
  admin: 'מנהל מערכת',
  auditor: 'מבקר',
};
interface GrantLike {
  id: string;
  role: Role;
  unit_id: string | null;
}

type Units = ReadonlyMap<string, string>;

export const KIND_LABELS: Record<ChangeRequest['kind'], string> = {
  add_role: 'תפקיד נוסף',
  remove_role: 'הסרת תפקיד',
  move_unit: 'מעבר יחידה',
  details: 'עדכון פרטים',
};

export const STATUS_LABELS: Record<ChangeRequest['status'], string> = {
  pending: 'ממתינה לאישור',
  approved: 'אושרה',
  rejected: 'נדחתה',
  cancelled: 'בוטלה',
};

const DETAIL_LABELS: Record<string, string> = {
  first_name: 'שם פרטי',
  last_name: 'שם משפחה',
  job_title: 'תפקיד בעירייה',
  phone: 'טלפון',
};

const UNITLESS: readonly Role[] = ['admin', 'auditor'];

/** "עורך · אגף החינוך", or the role alone for admin and auditor. */
export function grantLabel(grant: { role: Role; unit_id: string | null }, units: Units): string {
  const role = ROLE_LABELS[grant.role];
  if (UNITLESS.includes(grant.role) || !grant.unit_id) return role;
  return `${role} · ${units.get(grant.unit_id) ?? 'יחידה לא זמינה'}`;
}

/** One line on what a request asks for. */
export function changeSummary(
  change: ChangeRequest,
  units: Units,
  grants: readonly GrantLike[],
): string {
  const kind = KIND_LABELS[change.kind];
  if (change.kind === 'details') {
    const fields = Object.keys(change.details ?? {}).map((key) => DETAIL_LABELS[key] ?? key);
    return `${kind}: ${fields.join(', ')}`;
  }
  if (change.kind === 'move_unit') {
    return `${kind}: ${units.get(change.unit_id ?? '') ?? 'יחידה לא זמינה'}`;
  }
  if (change.kind === 'remove_role') {
    const grant = grants.find((g) => g.id === change.grant_id);
    return grant ? `${kind}: ${grantLabel(grant, units)}` : kind;
  }
  return change.role
    ? `${kind}: ${grantLabel({ role: change.role, unit_id: change.unit_id }, units)}`
    : kind;
}

/** The new values of a details change, for the manager who decides it. */
export function detailsText(details: Record<string, string> | null): string {
  return Object.entries(details ?? {})
    .map(([key, value]) => `${DETAIL_LABELS[key] ?? key}: ${value || 'ללא'}`)
    .join(' · ');
}

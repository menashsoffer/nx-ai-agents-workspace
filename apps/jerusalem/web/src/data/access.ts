import { DataError } from './client.ts';
import { array, object, text } from './parse.ts';

export type Role = 'viewer' | 'editor' | 'unit_manager' | 'admin' | 'auditor';
export interface Grant {
  role: Role;
  unitId: string | null;
}
export interface Access {
  state: 'active' | 'pending' | 'rejected' | 'blocked' | 'unregistered';
  member: boolean;
  admin: boolean;
  editor: boolean;
  manager: boolean;
  grants: Grant[];
}

function parseFlags(value: unknown): Pick<Access, 'member' | 'admin' | 'editor' | 'manager'> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new DataError(0);
  const data = value as Record<string, unknown>;
  for (const key of ['member', 'admin', 'editor', 'manager']) {
    if (typeof data[key] !== 'boolean') throw new DataError(0);
  }
  return {
    member: data.member === true,
    admin: data.admin === true,
    editor: data.editor === true,
    manager: data.manager === true,
  };
}

function isRole(role: string): role is Role {
  return ['viewer', 'editor', 'unit_manager', 'admin', 'auditor'].includes(role);
}

export function parseAccess(value: unknown): Access {
  const data = object(value);
  const flags = parseFlags(data);
  const status = text(data.state);
  if (!['active', 'pending', 'rejected', 'blocked', 'unregistered'].includes(status)) {
    throw new DataError(0);
  }
  const grants = array(data.grants).map((value) => {
    const grant = object(value);
    const role = text(grant.role);
    if (!isRole(role)) throw new DataError(0);
    return { role, unitId: grant.unitId === null ? null : text(grant.unitId) };
  });
  return { ...flags, state: status as Access['state'], grants };
}

export function mayWriteUnit(access: Access, unitId: string): boolean {
  return (
    access.state === 'active' &&
    (access.admin ||
      access.grants.some(
        (grant) =>
          grant.unitId === unitId && (grant.role === 'editor' || grant.role === 'unit_manager'),
      ))
  );
}

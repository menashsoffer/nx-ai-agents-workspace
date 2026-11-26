// A small organisation: one administration with two departments, a registry owned
// by the first department, and one user per role.
export const UNIT_1 = '20000000-0000-0000-0000-000000000001';
export const UNIT_2 = '20000000-0000-0000-0000-000000000002';
export const REGISTRY = '30000000-0000-0000-0000-000000000001';
export const VERSION = '30000000-0000-0000-0000-000000000002';
export const SUPPLIER = '40000000-0000-0000-0000-000000000001';

export const USERS = {
  admin: '10000000-0000-0000-0000-00000000000a',
  manager: '10000000-0000-0000-0000-00000000000b',
  editor: '10000000-0000-0000-0000-00000000000c',
  viewer: '10000000-0000-0000-0000-00000000000d',
  otherViewer: '10000000-0000-0000-0000-00000000000e',
  pending: '10000000-0000-0000-0000-00000000000f',
  blocked: '10000000-0000-0000-0000-000000000010',
  auditor: '10000000-0000-0000-0000-000000000011',
} as const;

const ROLES: [keyof typeof USERS, string, string | null][] = [
  ['admin', 'admin', null],
  ['manager', 'unit_manager', UNIT_1],
  ['editor', 'editor', UNIT_1],
  ['viewer', 'viewer', UNIT_1],
  ['otherViewer', 'viewer', UNIT_2],
  ['blocked', 'viewer', UNIT_1],
  ['auditor', 'auditor', null],
];

function profile(key: keyof typeof USERS): string {
  const status = key === 'pending' ? 'pending' : key === 'blocked' ? 'blocked' : 'active';
  const reviewed = status === 'pending' ? 'null' : 'now()';
  const unit = key === 'otherViewer' ? UNIT_2 : UNIT_1;
  return `('${USERS[key]}', '${key}', 'test', '${USERS[key]}@example.test', 'staff',
    '${unit}', 'testing access', '${status}', ${reviewed})`;
}

export const ACCESS_FIXTURE = `
  insert into auth.users (id) select unnest(array[${Object.values(USERS)
    .map((u) => `'${u}'::uuid`)
    .join(', ')}]);
  insert into public.org_units (id, name, kind, verified) values
    ('20000000-0000-0000-0000-000000000000', 'מינהל', 'administration', true);
  insert into public.org_units (id, name, kind, parent_id, verified) values
    ('${UNIT_1}', 'אגף 1', 'department', '20000000-0000-0000-0000-000000000000', true),
    ('${UNIT_2}', 'אגף 2', 'department', '20000000-0000-0000-0000-000000000000', true);
  insert into public.profiles (user_id, first_name, last_name, email, job_title, unit_id,
    purpose, status, reviewed_at) values
    ${(Object.keys(USERS) as (keyof typeof USERS)[]).map(profile).join(',\n')};
  insert into public.role_grants (user_id, role, unit_id) values
    ${ROLES.map(([k, r, u]) => `('${USERS[k]}', '${r}', ${u ? `'${u}'` : 'null'})`).join(', ')};
  insert into public.registries (id, name, owner_unit_id) values ('${REGISTRY}', 'מאגר', '${UNIT_1}');
  insert into public.registry_versions (id, registry_id) values ('${VERSION}', '${REGISTRY}');
  insert into public.suppliers (id, display_name) values ('${SUPPLIER}', 'ספק');
  insert into public.supplier_identifiers (supplier_id, scheme, value) values
    ('${SUPPLIER}', 'company', '512345678'), ('${SUPPLIER}', 'personal_id', '012345678');
`;

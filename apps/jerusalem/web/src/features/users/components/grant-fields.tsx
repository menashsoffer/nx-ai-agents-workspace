import { SelectField } from '../../../ui/select-field.tsx';
import type { Profile, Unit } from '../api/users.ts';
import { ROLE_LABELS, globalRole } from '../model/permissions.ts';

function UserChoice({ profiles, chosen }: { profiles: Profile[]; chosen: string }) {
  return (
    <SelectField
      field={{ label: 'משתמש' }}
      select={{
        name: 'target_user',
        required: true,
        defaultValue: chosen,
        children: (
          <>
            <option value="">בחירת משתמש</option>
            {profiles.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.first_name} {p.last_name}
              </option>
            ))}
          </>
        ),
      }}
    />
  );
}
interface UnitProps {
  units: Unit[];
  global: boolean;
  chosen: string;
}
function UnitChoice({ units, global, chosen }: UnitProps) {
  return (
    <SelectField
      field={{
        label: 'יחידה',
        hint: global ? 'תפקיד זה חל על כלל המערכת.' : 'ההרשאה חלה על היחידה שנבחרה.',
      }}
      select={{
        name: 'target_unit',
        required: !global,
        disabled: global,
        defaultValue: chosen,
        children: (
          <>
            <option value="">בחירת יחידה</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </>
        ),
      }}
    />
  );
}
interface Props {
  /** Left out when the user is already known, as in approving a request. */
  profiles?: Profile[];
  scope: { admin: boolean; units: Unit[] };
  role: { value: string; change: (value: string) => void };
  chosen?: { user?: string; unit?: string };
}
/** User, role and unit; a unit manager is offered only viewer and editor of their units. */
export function GrantFields({ profiles, scope, role, chosen = {} }: Props) {
  const roles = Object.entries(ROLE_LABELS).filter(
    ([key]) => scope.admin || ['viewer', 'editor'].includes(key),
  );
  return (
    <>
      {profiles && <UserChoice profiles={profiles} chosen={chosen.user ?? ''} />}
      <SelectField
        field={{ label: 'תפקיד' }}
        select={{
          name: 'wanted_role',
          value: role.value,
          onChange: (e) => {
            role.change(e.currentTarget.value);
          },
          children: roles.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          )),
        }}
      />
      <UnitChoice units={scope.units} global={globalRole(role.value)} chosen={chosen.unit ?? ''} />
    </>
  );
}

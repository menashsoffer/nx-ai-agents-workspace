import { useDeferredValue, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { ConfirmDialog } from '../../../ui/confirm-dialog.tsx';
import { IconButton } from '../../../ui/icon-button.tsx';
import { DataTable } from '../../../ui/data-table.tsx';
import { EmptyState } from '../../../ui/empty-state.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { errorText } from '../../../data/errors.ts';
import { removeGrant, type GrantRow, type Profile } from '../api/users.ts';
import { matchesPerson } from '../model/people.ts';
import { ROLE_LABELS } from '../model/permissions.ts';
import { GRANT_DIALOG } from './grant-form.tsx';
import styles from './users.module.css';

const REVOKE = 'revoke-grant';
interface Props {
  profiles: Profile[];
  grants: GrantRow[];
  units: ReadonlyMap<string, string>;
  /** Grants this person may remove; the database checks again. */
  mayRevoke: (grant: GrantRow) => boolean;
  grantTo: (userId: string) => void;
}
const COLUMNS = [
  { id: 'name', label: 'שם' },
  { id: 'email', label: 'דוא״ל' },
  { id: 'unit', label: 'יחידה' },
  { id: 'roles', label: 'תפקידים' },
  { id: 'action', label: 'פעולה' },
];

function roleText(grant: GrantRow, units: Props['units']) {
  const role = ROLE_LABELS[grant.role];
  return grant.unit_id ? `${role} · ${units.get(grant.unit_id) ?? 'יחידה לא זמינה'}` : role;
}

interface TagProps {
  grant: GrantRow;
  label: string;
  person: string;
  removable: boolean;
  pick: (grant: GrantRow) => void;
}
function RoleTag({ grant, label, person, removable, pick }: TagProps) {
  return (
    <li>
      {label}
      {removable && (
        <IconButton
          icon="close"
          size="small"
          className={styles.tagRemove}
          label={`הסרת התפקיד ${label} מ${person}`}
          tip="הסרת התפקיד"
          command={{ target: REVOKE, action: 'show-modal' }}
          onClick={() => {
            pick(grant);
          }}
        />
      )}
    </li>
  );
}

function useRevoke(grant: GrantRow | null) {
  return async () => {
    if (!grant) return '';
    try {
      await removeGrant(grant.id);
      return '';
    } catch (error) {
      return errorText(error);
    }
  };
}

type RowContext = Omit<Props, 'profiles'> & { pick: (grant: GrantRow) => void };

function userRow(p: Profile, { grants, units, mayRevoke, grantTo, pick }: RowContext) {
  const name = `${p.first_name} ${p.last_name}`;
  const own = grants.filter((g) => g.user_id === p.user_id);
  return {
    id: p.user_id,
    cells: {
      name,
      email: <bdi>{p.email}</bdi>,
      unit: p.unit_id ? (units.get(p.unit_id) ?? 'יחידה לא זמינה') : '—',
      roles: own.length ? (
        <ul className={styles.tags}>
          {own.map((g) => (
            <RoleTag
              key={g.id}
              grant={g}
              label={roleText(g, units)}
              person={name}
              removable={mayRevoke(g)}
              pick={pick}
            />
          ))}
        </ul>
      ) : (
        'אין תפקיד'
      ),
      action: (
        <Button
          variant="quiet"
          aria-label={`מתן תפקיד ל${name}`}
          command={{ target: GRANT_DIALOG, action: 'show-modal' }}
          onClick={() => {
            grantTo(p.user_id);
          }}
        >
          מתן תפקיד
        </Button>
      ),
    },
  };
}

function UserSearch({ query, change }: { query: string; change: (value: string) => void }) {
  return (
    <search aria-label="חיפוש משתמשים">
      <FormField
        field={{ label: 'חיפוש לפי שם או דוא״ל' }}
        input={{
          type: 'search',
          value: query,
          onChange: (e) => {
            change(e.currentTarget.value);
          },
        }}
      />
    </search>
  );
}

interface RevokeProps {
  chosen: GrantRow | null;
  profiles: Profile[];
  units: Props['units'];
}
function RevokeConfirm({ chosen, profiles, units }: RevokeProps) {
  const run = useRevoke(chosen);
  const person = profiles.find((p) => p.user_id === chosen?.user_id);
  const name = person ? `${person.first_name} ${person.last_name}` : 'המשתמש';
  return (
    <ConfirmDialog
      id={REVOKE}
      title={chosen ? `להסיר את התפקיד ${roleText(chosen, units)} מ${name}?` : 'להסיר את התפקיד?'}
      action={{ label: 'הסרת התפקיד', run }}
    >
      <p>ההרשאה תיפסק מיד. אפשר לתת את התפקיד שוב בכל עת.</p>
    </ConfirmDialog>
  );
}

/** "משתמשים": search by name or email, roles as tags with × (screens-spec 6). */
export function UsersTable({ profiles, ...context }: Props) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<GrantRow | null>(null);
  const deferred = useDeferredValue(query);
  const rows = profiles
    .filter((p) => matchesPerson(p, deferred))
    .map((p) => userRow(p, { ...context, pick: setChosen }));
  return (
    <>
      <UserSearch query={query} change={setQuery} />
      {rows.length ? (
        <div className={styles.grants}>
          <DataTable caption="משתמשים פעילים" columns={COLUMNS} rows={rows} />
        </div>
      ) : (
        <EmptyState title="לא נמצאו משתמשים" />
      )}
      <RevokeConfirm chosen={chosen} profiles={profiles} units={context.units} />
    </>
  );
}

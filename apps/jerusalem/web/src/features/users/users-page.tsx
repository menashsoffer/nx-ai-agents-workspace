import { useState } from 'react';
import { Link, useLoaderData, useNavigation, useSearchParams } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { EmptyState } from '../../ui/empty-state.tsx';
import { PageHeader } from '../../ui/page-header.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';
import { loadUsers, USERS_KEY } from './api/users.ts';
import { getScreenData } from '../../data/screen-data.ts';
import { useScreenData } from '../../data/react-screen-data.ts';
import { activeGrants, availableUnits, mayRevoke } from './model/permissions.ts';
import { ProfileReview } from './components/profile-review.tsx';
import { GRANT_DIALOG, GrantDialog } from './components/grant-form.tsx';
import { UsersTable } from './components/users-table.tsx';
import { ChangeRequests } from './components/change-review.tsx';
import styles from './components/users.module.css';

export const loader = () => getScreenData(USERS_KEY, loadUsers);
type Data = Awaited<ReturnType<typeof loader>>;
const TITLE = 'משתמשים ותפקידים';

function Tabs({ current, waiting, people }: { current: string; waiting: number; people: number }) {
  const tabs = [
    ['requests', `בקשות ממתינות (${String(waiting)})`],
    ['users', `משתמשים (${String(people)})`],
  ] as const;
  return (
    <nav aria-label="אזורי המסך" className={styles.tabs}>
      {tabs.map(([id, label]) => (
        <Link key={id} to={`?tab=${id}`} aria-current={current === id ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Requests({
  data,
  scope,
}: {
  data: Data;
  scope: { admin: boolean; units: Data['units'] };
}) {
  const pending = data.profiles.filter((p) => p.status === 'pending');
  const unitNames = new Map(data.units.map((u) => [u.id, u.name]));
  return (
    <>
      <h2>בקשות גישה</h2>
      {pending.length ? (
        pending.map((profile) => (
          <ProfileReview
            key={profile.user_id}
            profile={profile}
            currentUser={data.who.userId}
            unit={unitNames.get(profile.unit_id ?? '') ?? 'יחידה לא זמינה'}
            scope={scope}
          />
        ))
      ) : (
        <EmptyState title="אין בקשות גישה ממתינות" />
      )}
      {data.changes && (
        <ChangeRequests
          changes={data.changes}
          profiles={data.profiles}
          grants={data.grants}
          units={unitNames}
        />
      )}
    </>
  );
}

export function UsersPage() {
  const data = useScreenData(USERS_KEY, useLoaderData<typeof loader>(), loadUsers).value;
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const [grantTo, setGrantTo] = useState('');
  const active = data.profiles.filter((p) => p.status === 'active');
  const waiting =
    data.profiles.filter((p) => p.status === 'pending').length + (data.changes?.length ?? 0);
  const tab = params.get('tab') ?? (waiting ? 'requests' : 'users');
  const scope = {
    admin: data.who.access.admin,
    units: availableUnits(data.units, data.who.access),
  };
  if (navigation.state === 'loading') return <Skeleton />;
  return (
    <div className={styles.page}>
      <PageHeader
        title={TITLE}
        lead="אישור בקשות גישה ושינוי, ומתן או הסרה של תפקידים."
        back={{ to: '/admin', label: 'ניהול' }}
        action={
          <Button
            command={{ target: GRANT_DIALOG, action: 'show-modal' }}
            onClick={() => {
              setGrantTo('');
            }}
          >
            מתן תפקיד
          </Button>
        }
      />
      <Tabs current={tab} waiting={waiting} people={active.length} />
      {tab === 'users' ? (
        <UsersTable
          profiles={active}
          grants={activeGrants(data.grants, data.now)}
          units={new Map(data.units.map((u) => [u.id, u.name]))}
          mayRevoke={(grant) => mayRevoke(grant, data.who.access)}
          grantTo={setGrantTo}
        />
      ) : (
        <Requests data={data} scope={scope} />
      )}
      <GrantDialog profiles={active} scope={scope} chosen={grantTo} />
    </div>
  );
}

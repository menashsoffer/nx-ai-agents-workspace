import { dayOf, when } from '../../../lib/dates.ts';
import { Icon } from '../../../ui/icon.tsx';
import type { Account, MyProfile } from '../api/account.ts';
import styles from './account.module.css';

interface Props {
  profile: MyProfile;
  unit: string;
  account: Pick<Account, 'signedInAt'>;
}
function initials(profile: MyProfile): string {
  return [profile.first_name, profile.last_name].map((part) => part.trim()[0] ?? '').join('');
}

/** Who is signed in, at a glance: name, job, unit, email and dates. */
export function ProfileCard({ profile, unit, account }: Props) {
  return (
    <section aria-labelledby="profile-name" className={styles.profile}>
      <span className={styles.avatar} aria-hidden="true">
        {initials(profile)}
      </span>
      <div className={styles.who}>
        <h2 id="profile-name">
          {profile.first_name} {profile.last_name}
        </h2>
        <p>
          {profile.job_title} · {unit}
        </p>
        <p dir="ltr" className={styles.email}>
          {profile.email}
        </p>
      </div>
      <dl className={styles.dates}>
        <div>
          <dt>
            <Icon name="calendar" /> במערכת מאז
          </dt>
          <dd>{dayOf(profile.created_at)}</dd>
        </div>
        <div>
          <dt>
            <Icon name="clock" /> כניסה אחרונה
          </dt>
          <dd>{account.signedInAt ? when(account.signedInAt) : 'לא ידוע'}</dd>
        </div>
      </dl>
    </section>
  );
}

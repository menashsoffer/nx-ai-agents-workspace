import { Button } from '../../../ui/button.tsx';
import type { Profile, Unit } from '../api/users.ts';
import { ApproveDialog, approveId, RejectDialog, rejectId } from './request-dialogs.tsx';
import styles from './users.module.css';

interface Props {
  profile: Profile;
  currentUser: string;
  unit: string;
  scope: { admin: boolean; units: Unit[] };
}
/** One access request: who, from where and why, then approve with a role or reject. */
export function ProfileReview({ profile, currentUser, unit, scope }: Props) {
  const name = `${profile.first_name} ${profile.last_name}`;
  return (
    <article className={styles.card} aria-label={`בקשת גישה של ${name}`}>
      <h3>{name}</h3>
      <p>
        <bdi>{profile.email}</bdi> · {profile.job_title} · {unit}
      </p>
      <p>{profile.purpose}</p>
      {profile.user_id === currentUser ? (
        <p>אין לאשר את הבקשה של עצמך.</p>
      ) : (
        <div className={styles.actions}>
          <Button command={{ target: approveId(profile.user_id), action: 'show-modal' }}>
            אישור הגישה
          </Button>
          <Button
            variant="secondary"
            command={{ target: rejectId(profile.user_id), action: 'show-modal' }}
          >
            דחיית הבקשה
          </Button>
          <ApproveDialog profile={profile} name={name} scope={scope} />
          <RejectDialog profile={profile} name={name} />
        </div>
      )}
    </article>
  );
}

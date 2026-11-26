import { useActionState, useId, useState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { errorText } from '../../../data/errors.ts';
import { dayOf } from '../../../lib/dates.ts';
import {
  areaLink,
  cancelInvite,
  inviteMember,
  removeMember,
  type Member,
  type MemberRole,
  type Members,
  type OpenInvite,
} from '../api/members.ts';
import { canRemove, inviteProblem, memberName, ROLE_LABELS } from '../model/members.ts';
import styles from './area.module.css';

/** Runs a change, reloads the area and returns an error sentence or ''. */
function useChange() {
  const { revalidate } = useRevalidator();
  return async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
    } catch (failure) {
      return errorText(failure);
    }
    await revalidate();
    return '';
  };
}

/** Asks before removing; Cancel is focused (ui-building-blocks-spec-he.md 6.2). */
function Remove({ member }: { member: Member }) {
  const id = useId();
  const change = useChange();
  const title = member.is_me ? 'להסיר את עצמכם מהספק?' : `להסיר את ${memberName(member)}?`;
  const [error, action, pending] = useActionState(async () => {
    const message = await change(() => removeMember(member.id));
    if (!message) (document.getElementById(id) as HTMLDialogElement | null)?.close();
    return message;
  }, '');
  return (
    <>
      <Button type="button" variant="quiet" command={{ target: id, action: 'show-modal' }}>
        {member.is_me ? 'יציאה מהספק' : 'הסרה'}
      </Button>
      <Dialog id={id} title={title}>
        <form action={action} aria-label={title}>
          <p>
            {member.is_me
              ? 'לא תוכלו לראות את התיק של הספק עד שתוזמנו שוב.'
              : 'האדם לא יוכל לראות את התיק של הספק. אפשר להזמין אותו שוב בכל עת.'}
          </p>
          {error && <Notice tone="error" title={error} />}
          <FormActions>
            {/* eslint-disable-next-line jsx-a11y-x/no-autofocus */}
            <Button variant="quiet" command={{ target: id, action: 'close' }} autoFocus>
              ביטול
            </Button>
            <Button type="submit" variant="danger" pending={pending} pendingLabel="מסיר…">
              הסרה
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}

function People({ list }: { list: Members }) {
  return (
    <ul className={styles.list}>
      {list.members.map((member) => (
        <li key={member.id}>
          <strong>
            {memberName(member)}
            {member.is_me && ' (אני)'}
          </strong>
          <span className={styles.muted}>
            {` · ${ROLE_LABELS[member.role]}`}
            {member.job_title && ` · ${member.job_title}`}
            {member.email && (
              <>
                {' · '}
                <bdi>{member.email}</bdi>
              </>
            )}
          </span>
          {canRemove(member, list) && <Remove member={member} />}
        </li>
      ))}
    </ul>
  );
}

function Invite({ invite }: { invite: OpenInvite }) {
  const change = useChange();
  const [error, action, pending] = useActionState(() => change(() => cancelInvite(invite.id)), '');
  return (
    <li>
      <form action={action} aria-label={`הזמנה ל-${invite.email}`}>
        <bdi>{invite.email}</bdi>
        <span className={styles.muted}>
          {` · ${ROLE_LABELS[invite.role]} · ממתינה עד ${dayOf(invite.expires_at)}`}
        </span>
        {error && <Notice tone="error" title={error} />}
        <Button type="submit" variant="quiet" pending={pending} pendingLabel="מבטל…">
          ביטול ההזמנה
        </Button>
      </form>
    </li>
  );
}

function SentNotice({ email }: { email: string }) {
  return (
    <Notice tone="success" title={`ההזמנה ל-${email} נשמרה, בתוקף 14 יום.`}>
      המערכת לא שולחת דוא"ל. שלחו לו את הקישור {areaLink()} והוא ייכנס עם הכתובת הזו.
    </Notice>
  );
}

function RoleField() {
  return (
    <SelectField
      field={{ label: 'הרשאה', hint: 'מורשה יכול גם להזמין ולהסיר אנשים' }}
      select={{
        name: 'role',
        defaultValue: 'member',
        children: (['member', 'owner'] as const).map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        )),
      }}
    />
  );
}

interface Sent {
  error: string;
  sent: string;
}

function InviteForm({ supplierId, list }: { supplierId: string; list: Members }) {
  const change = useChange();
  const [email, setEmail] = useState('');
  const [state, action, pending] = useActionState(
    async (_previous: Sent, form: FormData): Promise<Sent> => {
      const role: MemberRole = form.get('role') === 'owner' ? 'owner' : 'member';
      const problem = inviteProblem(email, list);
      if (problem) return { error: problem, sent: '' };
      const address = email.trim().toLowerCase();
      const error = await change(() => inviteMember({ supplierId, email: address, role }));
      if (!error) setEmail('');
      return { error, sent: error ? '' : address };
    },
    { error: '', sent: '' },
  );
  return (
    <form action={action} aria-label="הזמנת עובד" noValidate>
      {state.error && <Notice tone="error" title={state.error} />}
      {state.sent && <SentNotice email={state.sent} />}
      <FormField
        field={{ label: 'דוא"ל', hint: 'הכתובת שאיתה העובד ייכנס' }}
        input={{
          name: 'email',
          type: 'email',
          required: true,
          autoComplete: 'off',
          value: email,
          onChange: (event) => {
            setEmail(event.currentTarget.value);
          },
        }}
      />
      <RoleField />
      <FormActions>
        <Button type="submit" variant="secondary" pending={pending} pendingLabel="שומר…">
          הזמנת עובד
        </Button>
      </FormActions>
    </form>
  );
}

/** "המשתמשים שלנו" (spec 6.8): only an owner sees it. */
export function OurPeople({ supplierId, list }: { supplierId: string; list: Members }) {
  return (
    <section className={styles.panel} aria-labelledby="people-title">
      <h2 id="people-title" tabIndex={-1}>
        המשתמשים שלנו
      </h2>
      <People list={list} />
      {list.invites.length > 0 && (
        <>
          <h3>הזמנות שעוד לא התקבלו</h3>
          <ul className={styles.list}>
            {list.invites.map((invite) => (
              <Invite key={invite.id} invite={invite} />
            ))}
          </ul>
        </>
      )}
      <InviteForm supplierId={supplierId} list={list} />
    </section>
  );
}

import { useActionState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { decideMember, type Member } from '../api/registries.ts';
import { STATUS_LABELS, memberUntil } from '../model/review.ts';
import styles from './registries.module.css';

interface Props {
  member: Member;
  version: string;
  registryUntil: string | null;
}

function Reject({ member, version }: Omit<Props, 'registryUntil'>) {
  const id = `membership-reject-${member.id}`;
  const title = `דחיית ${member.supplier} מהמאגר`;
  const [error, action, saving] = useActionState(async (_previous: string, form: FormData) => {
    const value = form.get('note');
    const note = typeof value === 'string' ? value.trim() : '';
    if (note.length < 2) return 'צריך לכתוב למה הספק לא תואם למסמך.';
    const message = await decideMember(version, { id: member.id, note });
    if (!message) (document.getElementById(id) as HTMLDialogElement | null)?.close();
    return message;
  }, '');
  return (
    <>
      <Button type="button" variant="secondary" command={{ target: id, action: 'show-modal' }}>
        לא תואם
      </Button>
      <Dialog id={id} title={title}>
        <form action={action} aria-label={title} noValidate>
          {error && <Notice tone="error" title={error} />}
          <FormField
            field={{ label: 'סיבה', hint: 'למשל: לא מופיע במסמך, או מופיע בתחום אחר.' }}
            input={{ name: 'note', required: true, maxLength: 500 }}
          />
          <FormActions>
            <Button type="submit" pending={saving}>
              דחייה
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </>
  );
}

function Verify({ member, version }: Omit<Props, 'registryUntil'>) {
  const [error, action, saving] = useActionState(
    () => decideMember(version, { id: member.id, note: null }),
    '',
  );
  return (
    <form action={action} aria-label={`אימות ${member.supplier}`}>
      <Button type="submit" pending={saving} pendingLabel="מאמת…">
        מופיע במסמך
      </Button>
      {error && <Notice tone="error" title={error} />}
    </form>
  );
}

/** One supplier of the registry, checked against the document on its own (Menash, 25.11). */
export function MemberRow({ member, version, registryUntil }: Props) {
  const published = member.name_as_published ?? member.supplier;
  const where = [member.field, member.source_page ? `עמוד ${String(member.source_page)}` : null];
  return (
    <li className={styles.row}>
      <div>
        <strong>{published}</strong>
        {published !== member.supplier && (
          <span className={styles.muted}> · במערכת: {member.supplier}</span>
        )}
        <div className={styles.muted}>
          {[...where.filter(Boolean), memberUntil(member, registryUntil)].join(' · ')}
        </div>
        <div>
          {STATUS_LABELS[member.review_status]}
          {member.note && <span className={styles.muted}> · {member.note}</span>}
          {' · '}
          <Link to={`/supplier/${member.supplier_id}`}>דף הספק</Link>
        </div>
      </div>
      <div className={styles.actions}>
        {member.review_status !== 'verified' && <Verify member={member} version={version} />}
        {member.review_status !== 'rejected' && <Reject member={member} version={version} />}
      </div>
    </li>
  );
}

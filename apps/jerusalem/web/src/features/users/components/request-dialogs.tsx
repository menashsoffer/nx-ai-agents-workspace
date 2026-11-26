import { useActionState, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { approveProfile, type Profile, type Unit } from '../api/users.ts';
import { decideReview, INITIAL_REVIEW } from '../api/review.ts';
import { parseGrant } from '../model/permissions.ts';
import { GrantFields } from './grant-fields.tsx';

interface Props {
  profile: Profile;
  name: string;
  scope: { admin: boolean; units: Unit[] };
}
export const approveId = (id: string) => `approve-${id}`;
export const rejectId = (id: string) => `reject-${id}`;

function closeDialog(id: string) {
  const dialog = document.getElementById(id);
  if (dialog instanceof HTMLDialogElement) dialog.close();
}

function failure(error: unknown): string {
  return errorText(error);
}

function useApprove({ profile, scope }: Props) {
  return useActionState(async (_: string, form: FormData) => {
    const input = parseGrant({ ...Object.fromEntries(form), target_user: profile.user_id }, scope);
    if (!input.data) return input.error;
    try {
      await approveProfile({
        userId: profile.user_id,
        role: input.data.wanted_role,
        unit: input.data.target_unit,
        requestUnit: profile.unit_id,
      });
    } catch (error) {
      return failure(error);
    }
    closeDialog(approveId(profile.user_id));
    return '';
  }, '');
}

/** "אישור הגישה": role (viewer by default) and unit (the request's), given with the approval. */
export function ApproveDialog(props: Props) {
  const { profile, name, scope } = props;
  const [role, setRole] = useState('viewer');
  const [error, action, pending] = useApprove(props);
  return (
    <Dialog id={approveId(profile.user_id)} title={`אישור הגישה של ${name}`}>
      <form action={action} aria-label={`אישור הגישה של ${name}`}>
        {error && <Notice tone="error" title={error} />}
        <GrantFields
          key={error}
          scope={scope}
          role={{ value: role, change: setRole }}
          chosen={{ unit: profile.unit_id ?? '' }}
        />
        <FormActions>
          <Button type="submit" pending={pending}>
            אישור ומתן התפקיד
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

/** "דחיית הבקשה": a reason is required, and the person sees it. */
export function RejectDialog({ profile, name }: Omit<Props, 'scope'>) {
  const [result, action, pending] = useActionState(
    async (_: typeof INITIAL_REVIEW, form: FormData) => {
      form.set('decision', 'rejected');
      const done = await decideReview(profile.user_id, form);
      if (done.committed) closeDialog(rejectId(profile.user_id));
      return done;
    },
    INITIAL_REVIEW,
  );
  return (
    <Dialog id={rejectId(profile.user_id)} title={`דחיית הבקשה של ${name}`}>
      <form action={action} aria-label={`דחיית הבקשה של ${name}`} noValidate>
        {result.error && <Notice tone="error" title={result.error} />}
        <FormField
          field={{ label: 'נימוק', error: result.fieldError }}
          input={{ name: 'note', required: true, maxLength: 2000 }}
        />
        <FormActions>
          <Button type="submit" pending={pending}>
            דחיית הבקשה
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

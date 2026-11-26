import { useActionState, useState } from 'react';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { addGrant, type Profile, type Unit } from '../api/users.ts';
import { parseGrant } from '../model/permissions.ts';
import { GrantFields } from './grant-fields.tsx';

export const GRANT_DIALOG = 'grant-role';
interface Props {
  profiles: Profile[];
  scope: { admin: boolean; units: Unit[] };
  /** The row whose "מתן תפקיד" opened the dialog, if any. */
  chosen: string;
}
function useGrant(scope: Props['scope']) {
  return useActionState(async (_: string, form: FormData) => {
    const input = parseGrant(Object.fromEntries(form), scope);
    if (!input.data) return input.error;
    try {
      await addGrant(input.data);
    } catch (error) {
      return errorText(error);
    }
    const dialog = document.getElementById(GRANT_DIALOG);
    if (dialog instanceof HTMLDialogElement) dialog.close();
    return '';
  }, '');
}
/** "מתן תפקיד": a dialog with user, role and unit (screens-spec 6). */
export function GrantDialog({ profiles, scope, chosen }: Props) {
  const [role, setRole] = useState('viewer');
  const [error, action, pending] = useGrant(scope);
  return (
    <Dialog id={GRANT_DIALOG} title="מתן תפקיד">
      <form action={action} aria-label="מתן תפקיד">
        {error && <Notice tone="error" title={error} />}
        <GrantFields
          key={`${chosen}:${error}`}
          profiles={profiles}
          scope={scope}
          role={{ value: role, change: setRole }}
          chosen={{ user: chosen }}
        />
        <FormActions>
          <Button type="submit" pending={pending}>
            מתן התפקיד
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

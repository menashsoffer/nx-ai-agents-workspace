import { useActionState } from 'react';
import { FormField } from '../../../ui/form-field.tsx';
import { Button } from '../../../ui/button.tsx';
import { StatusMessage } from '../../../ui/status-message.tsx';
import { requestLink } from '../api/session.ts';
export function LoginForm() {
  const [state, action, pending] = useActionState(requestLink, { message: '', error: '' });
  return (
    <form action={action} aria-label="כניסה עם קישור לדוא״ל">
      <FormField
        field={{ label: 'דוא״ל', hint: 'כתובת החשבון שהורשה להיכנס למערכת' }}
        input={{
          type: 'email',
          name: 'email',
          required: true,
          autoComplete: 'email',
          maxLength: 320,
        }}
      />
      <Button type="submit" pending={pending} pendingLabel="שולח קישור…" data-usage="login.email">
        שליחת קישור כניסה
      </Button>
      <StatusMessage>{pending ? '' : state.message}</StatusMessage>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}

import type { ReactNode } from 'react';
import { redirect, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Notice } from '../../ui/notice.tsx';
import { StatusMessage } from '../../ui/status-message.tsx';
import { getAdminSession, getBootMessage, identity, type Identity } from '../../data/rpc.ts';
import { safePath } from '../../data/session.ts';
import { dayOf } from '../../lib/dates.ts';
import { LoginForm } from './components/login-form.tsx';
import { GoogleLogin } from './components/google-login.tsx';
import { AccessRequest } from './components/access-request.tsx';
import { MyAccount } from './components/my-account.tsx';
import { loadAccount, type Account } from './api/account.ts';
import { signOut } from './api/session.ts';
import { ACCESS_MESSAGES } from './model/access-policy.ts';
import styles from './components/auth.module.css';
export const EXPIRED_NOTICE = 'ההתחברות הסתיימה. יש להתחבר שוב, ואחרי הכניסה נחזור למסך הקודם.';
interface AuthData {
  who: Identity | null;
  account: Account | null;
  expired: boolean;
}
/** A signed-in user who was sent here on the way to another screen goes straight back. */
export async function loader({ request }: LoaderFunctionArgs): Promise<AuthData | Response> {
  const params = new URL(request.url).searchParams;
  const who = getAdminSession() ? await identity() : null;
  const next = safePath(params.get('next'));
  if (who?.access.state === 'active' && next) return redirect(next);
  const account = who ? await loadAccount(who) : null;
  return { who, account, expired: !who && params.get('reason') === 'expired' };
}
function Card({ children, message }: { children: ReactNode; message: string }) {
  return (
    <section className={styles.card}>
      <span className={styles.dots} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <h1 tabIndex={-1}>כניסה והרשאות</h1>
      {message && <p role="alert">{message}</p>}
      {children}
    </section>
  );
}
function SignOut() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="secondary">
        יציאה מהמערכת
      </Button>
    </form>
  );
}
/** Signed in but not active: the request form, the wait, or who to turn to. */
function NotActive({ who, account }: { who: Identity; account: Account | null }) {
  const { state } = who.access;
  if (state === 'unregistered')
    return <AccessRequest userId={who.userId} units={account?.units ?? []} />;
  if (state === 'pending') {
    const sent = account?.profile ? ` ב-${dayOf(account.profile.created_at)}` : '';
    return (
      <Notice tone="info" title={`הבקשה נשלחה${sent} וממתינה לאישור מנהל.`}>
        אחרי האישור יופיעו כאן התפקידים שלך, ותוכלו להתחיל לעבוד. אין צורך לשלוח שוב.
      </Notice>
    );
  }
  return <StatusMessage>{ACCESS_MESSAGES[state]}</StatusMessage>;
}
export function AuthPage() {
  const { who, account, expired } = useLoaderData<AuthData>();
  const message = getBootMessage() || (expired ? EXPIRED_NOTICE : '');
  if (who?.access.state === 'active' && account) return <MyAccount account={account} />;
  return (
    <Card message={message}>
      {who ? (
        <>
          <NotActive who={who} account={account} />
          <SignOut />
        </>
      ) : (
        <>
          <p className={styles.lead}>הכניסה מיועדת לעובדי העירייה שאושרו במערכת.</p>
          <GoogleLogin />
          <p className={styles.divider}>או בקישור לדוא״ל</p>
          <LoginForm />
        </>
      )}
    </Card>
  );
}

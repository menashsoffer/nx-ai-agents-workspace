import { getAdminSession, getKeeper } from '../../../data/rpc.ts';
import { z } from '../../../data/zod.ts';
import { sendLink, BASE, clearCatalog, logout } from '../../../data/site.ts';
import {
  googleAuthorizeUrl,
  nextFromHash,
  rememberNext,
  type BrowserContext,
} from '../../../data/session.ts';
const emailSchema = z.email().max(320);
export interface LoginResult {
  message: string;
  error: string;
}
export async function requestLink(_previous: LoginResult, form: FormData): Promise<LoginResult> {
  const value = form.get('email');
  const parsed = emailSchema.safeParse(typeof value === 'string' ? value.trim() : value);
  if (!parsed.success) return { message: '', error: 'יש להזין כתובת דוא״ל תקינה.' };
  try {
    rememberNext(window.localStorage, nextFromHash(window.location.hash));
    const redirect = window.location.origin + window.location.pathname;
    const response = await sendLink(parsed.data, redirect);
    if (!response.ok) throw new Error('request failed');
    return { message: 'אם החשבון מורשה, קישור כניסה נשלח לדוא״ל.', error: '' };
  } catch {
    return { message: '', error: 'לא ניתן לשלוח קישור כעת. יש לנסות שוב.' };
  }
}
export async function googleSignIn(ctx: BrowserContext): Promise<void> {
  rememberNext(ctx.storage, nextFromHash(ctx.location.hash));
  const url = new URL(ctx.location.href);
  const target = await googleAuthorizeUrl(ctx, BASE, url.origin + url.pathname);
  window.location.assign(target);
}
/** Ends the session here and on the server, so the saved refresh token stops working. */
export async function signOut(): Promise<void> {
  const token = getAdminSession()?.token;
  getKeeper().clear();
  await clearCatalog();
  if (token) await logout(token).catch(() => undefined);
  window.location.assign(window.location.pathname);
}

import {
  SESSION_KEY,
  exchangeGoogleCode,
  takeAuthError,
  takeNext,
  takeSession,
  FAILED_MESSAGE,
  type BrowserContext,
} from '../../../data/session.ts';
import { exchangeCode } from '../../../data/site.ts';

/** True when the address carries a sign-in coming back from Google or an email link. */
function returning(ctx: BrowserContext): boolean {
  return (
    new URL(ctx.location.href).searchParams.has('code') ||
    ctx.location.hash.includes('access_token=')
  );
}

export async function prepareAdmin(ctx: BrowserContext, exchange = exchangeCode) {
  const arrived = returning(ctx);
  let message = takeAuthError(ctx);
  try {
    await exchangeGoogleCode(ctx, exchange);
  } catch {
    message = FAILED_MESSAGE;
  }
  const taken = takeSession(ctx);
  if (message) ctx.storage.removeItem(SESSION_KEY);
  const session = message ? null : taken;
  // The screen the user was on before leaving for Google or the email link.
  const next = arrived && session ? takeNext(ctx.storage) : null;
  return { session, message, next };
}

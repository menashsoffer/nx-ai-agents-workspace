// Ties the saved session to the browser: renewal on a timer and when the tab returns,
// changes made in other tabs, and a move to the sign-in screen when the session ends.
import type { Location } from 'react-router';
import { SessionKeeper } from '../data/auth-session.ts';
import { SESSION_KEY } from '../data/session.ts';
import { clearCatalog, refreshGrant, setUnauthorizedHandler } from '../data/site.ts';
import type { createAdminRouter } from './router.tsx';

type Router = ReturnType<typeof createAdminRouter>;
type Place = Pick<Location, 'pathname' | 'search'>;

/** The sign-in screen, remembering where the user was so they return there afterwards.
 *  `ended`: a session this browser had has just ended, which the screen explains. */
export function signInPath(place: Place, ended = false): string {
  if (place.pathname === '/auth') return '/auth';
  const next = `/auth?next=${encodeURIComponent(place.pathname + place.search)}`;
  return ended ? `${next}&reason=expired` : next;
}

/** Where a page load starts when the saved session could not be renewed (hash routing). */
export function endedStart(hash: string): string {
  const [pathname = '/', query] = (hash.slice(1) || '/').split('?');
  return signInPath({ pathname, search: query ? `?${query}` : '' }, true);
}

export function browserKeeper(): SessionKeeper {
  return new SessionKeeper({
    storage: window.localStorage,
    refresh: refreshGrant,
    locks: 'locks' in navigator ? navigator.locks : undefined,
  });
}

export function watchSession(keeper: SessionKeeper, router: Router): void {
  keeper.start();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keeper.fresh().catch(() => undefined);
  });
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_KEY || event.key === null) keeper.reload();
  });
  keeper.onSignedOut(() => {
    void clearCatalog();
    void router.navigate(signInPath(router.state.location, true), { replace: true });
  });
  setUnauthorizedHandler(async (token) => {
    await keeper.recover(token).catch(() => null);
  });
}

import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useMatches, useNavigation, useRevalidator } from 'react-router';

import type { RouteHandle } from './routes.tsx';
import { SiteHeader } from './site-header.tsx';
import { OfflineBanner } from './offline-banner.tsx';

const SITE_NAME = 'איתור ספקים';

function isRouteHandle(value: unknown): value is RouteHandle {
  return typeof value === 'object' && value !== null && 'title' in value;
}

/** The title of the deepest route that names one. */
function useRouteTitle(): string {
  const titles = useMatches()
    .map((match) => match.handle)
    .filter(isRouteHandle)
    .map((handle) => handle.title);
  return titles.at(-1) ?? SITE_NAME;
}

/**
 * True while the next screen or a reload after a change (approve, grant, remove) is on its way.
 * The logo stripe then flows and the current screen fades (DESIGN.md 6.8).
 */
function useBusy(): { moving: boolean; busy: boolean } {
  const navigation = useNavigation().state;
  const revalidation = useRevalidator().state;
  return {
    moving: navigation === 'loading',
    busy: navigation !== 'idle' || revalidation !== 'idle',
  };
}

/** Shared frame: skip link, header, one main region. Moves focus to the new screen's h1. */
export function Layout() {
  const title = useRouteTitle();
  const { moving, busy } = useBusy();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = `${title} | ${SITE_NAME}`;
  }, [title]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    main.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [pathname]);

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          main.current?.querySelector<HTMLElement>('h1')?.focus();
        }}
      >
        דילוג לתוכן
      </a>
      <SiteHeader busy={busy} />
      <p className="shell-busy" role="status">
        {busy ? 'טוען את המסך…' : ''}
      </p>
      <OfflineBanner />
      <main
        id="main"
        ref={main}
        className="shell-main"
        tabIndex={-1}
        data-pending={moving || undefined}
      >
        <Outlet />
      </main>
    </>
  );
}

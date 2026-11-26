import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigation } from 'react-router';
import { Button } from '../ui/button.tsx';
import { BrandLogo } from './brand-logo.tsx';
import { getAdminSession } from '../data/rpc.ts';
import { signOut } from '../features/auth/api/session.ts';

const AREA_NAME = 'האזור האישי לספקים';

/**
 * The supplier area's own frame (supplier-portal-spec-he.md 6): the brand and the stripe of
 * the staff site, without its tabs or account menu, so a supplier never sees staff screens.
 */
export function SupplierAreaLayout() {
  const busy = useNavigation().state !== 'idle';
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    document.title = `${AREA_NAME} | עיריית ירושלים`;
    main.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [pathname]);
  return (
    <>
      <header className="shell-header">
        <div className="shell-header-inner">
          <Link to="/supplier-area" className="shell-brand">
            <BrandLogo />
            <span className="shell-brand-area">{AREA_NAME}</span>
          </Link>
          {getAdminSession() && (
            <form action={signOut}>
              <Button type="submit" variant="quiet">
                יציאה
              </Button>
            </form>
          )}
        </div>
        <div className="shell-stripe" aria-hidden="true" data-busy={busy || undefined} />
      </header>
      <main id="main" ref={main} className="shell-main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}

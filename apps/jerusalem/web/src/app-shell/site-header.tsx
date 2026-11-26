import { Link, useLocation } from 'react-router';

import { useCatalogSnapshot } from '../data/react-catalog.ts';
import { AccountMenu } from './account-menu.tsx';
import { BrandLogo } from './brand-logo.tsx';
import { allowedScreens } from './screens.ts';
import { sectionOf, visibleSections, type Section } from './sections.ts';

// Icon outlines follow Lucide (ISC license): house, search, clipboard-check, settings-2, user.
const ICONS: Record<Section['key'], string> = {
  home: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  catalog: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  requests: 'M9 4h6v3H9zM7 5H5v15h14V5h-2M9 13l2 2 4-4',
  admin: 'M14 17H5M19 7h-9M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

function Icon({ path }: { path: string }) {
  return (
    <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

/** The product logo, which links home. */
function Brand() {
  return (
    <Link to="/" className="shell-brand">
      <BrandLogo />
    </Link>
  );
}

/**
 * Top bar with the brand, the section tabs the user may open and the account menu, then the
 * logo color stripe, whose colors flow while a screen loads (DESIGN.md 6.8). Below 48rem the
 * tabs move to a bar fixed at the bottom of the screen (shell.css).
 */
export function SiteHeader({ busy = false }: { busy?: boolean }) {
  const current = sectionOf(useLocation().pathname);
  // The admin tab appears only for someone who may open at least one admin screen (spec 8.1).
  const access = useCatalogSnapshot()?.access;
  const sections = visibleSections(access, allowedScreens(access).length > 0);
  return (
    <header className="shell-header">
      <div className="shell-header-inner">
        <Brand />
        <nav aria-label="ניווט ראשי" className="shell-nav">
          {sections.map((section) => (
            <Link
              key={section.key}
              to={section.to}
              aria-current={section.key === current ? 'page' : undefined}
            >
              <Icon path={ICONS[section.key]} />
              {section.label}
            </Link>
          ))}
        </nav>
        <AccountMenu />
      </div>
      <div className="shell-stripe" aria-hidden="true" data-busy={busy || undefined} />
    </header>
  );
}

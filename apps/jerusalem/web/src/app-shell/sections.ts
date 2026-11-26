// The top-level sections of the site (DESIGN.md section 6.1). Every route belongs to one,
// so the matching tab stays selected on the screens inside it.
import type { Access } from '../data/access.ts';

export interface Section {
  key: 'home' | 'catalog' | 'requests' | 'admin';
  label: string;
  to: string;
}

export const SECTIONS: readonly Section[] = [
  { key: 'home', label: 'בית', to: '/' },
  { key: 'catalog', label: 'איתור ספקים', to: '/catalog' },
  // Short enough for one line in the phone's bottom bar (Menash, 25.11.2026).
  { key: 'requests', label: 'בקשות', to: '/engagement' },
  { key: 'admin', label: 'ניהול', to: '/admin' },
];

const CATALOG_PATHS = ['/catalog', '/supplier'];
const REQUEST_PATHS = ['/engagement', '/route-check'];

function startsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** The section a path belongs to, or null for screens outside them (sign-in, not found). */
export function sectionOf(pathname: string): Section['key'] | null {
  if (pathname === '/') return 'home';
  if (startsWithAny(pathname, CATALOG_PATHS)) return 'catalog';
  if (startsWithAny(pathname, REQUEST_PATHS)) return 'requests';
  const adminPaths = [
    '/admin',
    '/categories',
    '/identifiers',
    '/users',
    '/thresholds',
    '/registries',
  ];
  if (startsWithAny(pathname, [...adminPaths, '/load-control', '/import'])) return 'admin';
  return null;
}

/**
 * The tabs this user sees: the home tab only for active staff (a visitor's home is the
 * catalog, so the tab would only bounce back), the admin tab only with an admin screen.
 */
export function visibleSections(access: Access | null | undefined, admin: boolean): Section[] {
  const staff = access?.state === 'active' && (access.member || access.admin);
  return SECTIONS.filter(
    (section) => (section.key !== 'home' || staff) && (section.key !== 'admin' || admin),
  );
}

import type { ReactNode } from 'react';
import { AboutPage } from '../pages/AboutPage';
import { HomePage } from '../pages/HomePage';

export interface AppRoute {
  /** Path relative to the router basename, without a leading slash ('' = home). */
  path: string;
  element: ReactNode;
  /** Label in the main navigation; omit to keep the route out of the nav. */
  navLabel?: string;
}

/**
 * All routes of the site. Paths reserved by the Pages deployment (e.g.
 * `storybook`, see tools/pages) must not be used; App.spec.tsx enforces it.
 */
export const routes: AppRoute[] = [
  { path: '', element: <HomePage />, navLabel: 'בית' },
  { path: 'about', element: <AboutPage />, navLabel: 'אודות' },
];

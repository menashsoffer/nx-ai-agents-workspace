import { Navigate, type RouteObject } from 'react-router';

import { Layout } from './layout.tsx';
import { ScreenError } from './screen-error.tsx';
import { PageLoader } from '../ui/logo-dots.tsx';
import { RouteError } from './route-error.tsx';
import { getAdminSession, identity } from '../data/rpc.ts';

function prefetchAccess(): null {
  if (getAdminSession()) void identity().catch(() => undefined);
  return null;
}

/** Page title shown in the tab; every route sets one so screen readers announce the change. */
export interface RouteHandle {
  title: string;
}

/**
 * The route table. Each screen loads lazily, so a visitor downloads only the screen they open.
 * A feature adds exactly one entry here for its own route (work plan, section 3).
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    // Starts loading who the user is on any first screen, so the top bar shows the right tabs.
    loader: prefetchAccess,
    shouldRevalidate: () => false,
    // Shown while the first lazily loaded screen arrives.
    hydrateFallbackElement: <PageLoader />,
    children: [
      {
        path: 'catalog',
        handle: { title: 'איתור ספקים' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/catalog/catalog-page.tsx');
          return { Component: m.CatalogPage, loader: m.loader };
        },
      },
      {
        path: 'supplier/new',
        handle: { title: 'הוספת ספק' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/supplier/add-page.tsx');
          return { Component: m.AddSupplierPage, loader: m.loader };
        },
      },
      {
        path: 'supplier/:id',
        handle: { title: 'פרטי ספק' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/supplier/supplier-page.tsx');
          return { Component: m.SupplierPage, loader: m.loader };
        },
      },
      {
        path: 'categories',
        handle: { title: 'בקשות קטגוריה' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/categories/categories-page.tsx');
          return { Component: m.CategoriesPage, loader: m.loader };
        },
      },
      {
        path: 'identifiers',
        handle: { title: 'מועמדי מזהה ספק' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/identifiers/identifiers-page.tsx');
          return { Component: m.IdentifiersPage, loader: m.loader };
        },
      },
      // Staff start at the home screen; anyone else is sent on to the catalog's explanation.
      {
        index: true,
        handle: { title: 'בית' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('./home/home-page.tsx');
          return { Component: m.HomePage, loader: m.loader };
        },
      },
      {
        path: 'admin',
        handle: { title: 'ניהול' } satisfies RouteHandle,
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('./home-page.tsx');
          return { Component: m.HomePage, loader: m.loader };
        },
      },
      // Checking a saved request moved into the requests screen (screens-spec-he.md 2).
      {
        path: 'route-check',
        handle: { title: 'בקשות התקשרות' },
        element: <Navigate to="/engagement" replace />,
      },
      {
        path: 'engagement',
        handle: { title: 'בקשות התקשרות' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/route-check/engagement-page.tsx');
          return { Component: m.EngagementPage, loader: m.loader };
        },
      },
      {
        path: 'addresses',
        handle: { title: 'כתובות לבדיקה' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/addresses/addresses-page.tsx');
          return { Component: m.AddressesPage, loader: m.loader };
        },
      },
      {
        path: 'start',
        handle: { title: 'איך מתחילים' },
        errorElement: <ScreenError />,
        lazy: () => import('../features/start/start-page.tsx'),
      },
      {
        // The list, or one registry when a version is given.
        path: 'registries/:version?',
        handle: { title: 'אימות מאגרים' },
        errorElement: <ScreenError />,
        lazy: () => import('../features/registries/registries-route.tsx'),
      },
      {
        path: 'load-control',
        handle: { title: 'בקרת טעינה' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/load-control/load-control-page.tsx');
          return { Component: m.LoadControlPage, loader: m.loader };
        },
      },
      {
        path: 'users',
        handle: { title: 'משתמשים ותפקידים' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/users/users-page.tsx');
          return { Component: m.UsersPage, loader: m.loader };
        },
      },
      {
        path: 'supplier-links',
        handle: { title: 'שיוכים לאזור האישי' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/supplier-links/links-page.tsx');
          return { Component: m.SupplierLinksPage, loader: m.loader };
        },
      },
      {
        path: 'thresholds',
        handle: { title: 'אישור הסף החודשי' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/thresholds/thresholds-page.tsx');
          return { Component: m.ThresholdsPage, loader: m.loader };
        },
      },
      {
        path: 'import',
        handle: { title: 'קליטת ספקים מאקסל' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/excel-import/import-page.tsx');
          return { Component: m.ImportPage, loader: m.loader };
        },
      },
      {
        path: 'usage',
        handle: { title: 'שימוש באתר' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/usage/usage-page.tsx');
          return { Component: m.UsagePage, loader: m.loader };
        },
      },
      {
        path: 'errors',
        handle: { title: 'שגיאות באתר' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/errors/errors-page.tsx');
          return { Component: m.ErrorsPage, loader: m.loader };
        },
      },
      {
        path: 'auth',
        handle: { title: 'כניסה והרשאות' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/auth/auth-page.tsx');
          return { Component: m.AuthPage, loader: m.loader };
        },
      },
      {
        path: '*',
        handle: { title: 'הדף לא נמצא' } satisfies RouteHandle,
        lazy: async () => ({ Component: (await import('./not-found-page.tsx')).NotFoundPage }),
      },
    ],
  },
  // The supplier personal area has its own frame, without the staff tabs (supplier-portal spec 6).
  {
    path: '/supplier-area',
    errorElement: <RouteError />,
    hydrateFallbackElement: <PageLoader />,
    lazy: async () => ({
      Component: (await import('./supplier-area-layout.tsx')).SupplierAreaLayout,
    }),
    children: [
      {
        index: true,
        handle: { title: 'האזור האישי לספקים' },
        errorElement: <ScreenError />,
        lazy: async () => {
          const m = await import('../features/supplier-area/supplier-area-page.tsx');
          return { Component: m.SupplierAreaPage, loader: m.loader };
        },
      },
      {
        path: 'login',
        handle: { title: 'כניסה לספקים' },
        lazy: async () => ({
          Component: (await import('./supplier-area-login.tsx')).SupplierAreaLogin,
        }),
      },
    ],
  },
];

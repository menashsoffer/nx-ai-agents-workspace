import { NavLink, Route, Routes } from 'react-router';
import { cn } from '@starter/shared-utils';
import { NotFoundPage } from '../pages/NotFoundPage';
import { routes } from './routes';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-3 py-1.5 hover:bg-brand-50',
    isActive && 'bg-brand-100 font-semibold',
  );

export function App() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4">
      <header className="flex items-center justify-between gap-4 border-b border-brand-100 py-4">
        <span className="flex items-center gap-2 text-lg font-bold">
          {/* public/ assets go through BASE_URL so they work under /<repo>/ on Pages. */}
          <img
            src={`${import.meta.env.BASE_URL}logo.svg`}
            alt=""
            className="size-8"
          />
          אתר
        </span>
        <nav aria-label="ראשי" className="flex gap-2">
          {routes
            .filter((route) => route.navLabel)
            .map((route) => (
              <NavLink
                key={route.path}
                to={`/${route.path}`}
                end
                className={navLinkClass}
              >
                {route.navLabel}
              </NavLink>
            ))}
        </nav>
      </header>

      <main className="flex-1 py-8">
        <Routes>
          {routes.map((route) =>
            route.path === '' ? (
              <Route key="index" index element={route.element} />
            ) : (
              <Route
                key={route.path}
                path={route.path}
                element={route.element}
              />
            ),
          )}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;

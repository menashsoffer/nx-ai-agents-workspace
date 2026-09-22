import { NavLink, Route, Routes } from 'react-router';
import { cn } from '@starter/shared-utils';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-3 py-1.5 hover:bg-brand-50',
    isActive && 'bg-brand-100 font-semibold',
  );

export function App() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4">
      <header className="flex items-center justify-between gap-4 border-b border-brand-100 py-4">
        <span className="text-lg font-bold">אתר</span>
        <nav aria-label="ראשי" className="flex gap-2">
          <NavLink to="/" end className={navLinkClass}>
            בית
          </NavLink>
        </nav>
      </header>

      <main className="flex-1 py-8">
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;

import { Suspense } from 'react';
import { Link, Route, Routes } from 'react-router';
import { spikes as allSpikes, type Spike } from './spikes';

function SpikeIndex({ spikes }: { spikes: Spike[] }) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Sandbox</h1>
      <p className="text-muted">
        ניסויים זמניים. כל תיקייה ב־<code dir="ltr">src/spikes/</code> היא דף.
      </p>
      {spikes.length === 0 ? (
        <p>
          אין ניסויים עדיין. צרו אחד עם{' '}
          <code dir="ltr">pnpm new:spike my-idea</code>.
        </p>
      ) : (
        <ul className="space-y-2">
          {spikes.map(({ slug, meta }) => (
            <li key={slug}>
              <Link to={slug} className="text-brand-600 underline">
                {meta.title}
              </Link>
              {meta.description && (
                <span className="text-muted"> — {meta.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function App({ spikes = allSpikes }: { spikes?: Spike[] }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav className="mb-6">
        <Link to="/" className="text-sm text-brand-600">
          ← כל הניסויים
        </Link>
      </nav>
      <Suspense fallback={<p>טוען…</p>}>
        <Routes>
          <Route index element={<SpikeIndex spikes={spikes} />} />
          {spikes.map(({ slug, Component }) => (
            <Route key={slug} path={slug} element={<Component />} />
          ))}
        </Routes>
      </Suspense>
    </div>
  );
}

export default App;

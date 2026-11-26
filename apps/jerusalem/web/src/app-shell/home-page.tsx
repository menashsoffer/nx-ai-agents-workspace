import { Link, useLoaderData } from 'react-router';

import { useCatalogSnapshot } from '../data/react-catalog.ts';
import { identity, rpc } from '../data/rpc.ts';
import { z } from '../data/zod.ts';
import { Notice } from '../ui/notice.tsx';
import { PageHeader } from '../ui/page-header.tsx';
import { allowedScreens, waitingText, type AdminScreen, type OverviewKey } from './screens.ts';
import styles from './home-page.module.css';

type Counts = Partial<Record<OverviewKey, number | undefined>>;
const count = z.number().int().nonnegative().optional();
const overviewSchema = z.object({
  users_pending: count,
  identifiers_pending: count,
  categories_pending: count,
  thresholds_pending: count,
  addresses_not_found: count,
  supplier_links_pending: count,
});

interface CardsProps {
  title: string;
  screens: AdminScreen[];
  counts: Counts;
}

function Cards({ title, screens, counts }: CardsProps) {
  if (!screens.length) return null;
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      <ul className={styles.grid}>
        {screens.map((screen) => (
          <li key={screen.to} className={styles.card}>
            <Link to={screen.to} className={styles.link}>
              {screen.title}
            </Link>
            <span className={styles.description}>{screen.description}</span>
            <Waiting text={waitingText(screen, counts)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Waiting({ text }: { text: string | null }) {
  if (!text) return null;
  const idle = text === 'אין ממתינים';
  return <span className={idle ? styles.idle : styles.waiting}>{text}</span>;
}

/** Counters are a convenience: if they cannot be read, the cards show without them. */
export async function overview(): Promise<Counts> {
  try {
    return await rpc('admin_overview', {}, overviewSchema);
  } catch {
    return {};
  }
}

/** The cards depend on the user's roles, so they wait for server access and the counters. */
export async function loader(): Promise<{ counts: Counts }> {
  const [, counts] = await Promise.all([identity(), overview()]);
  return { counts };
}

/** Landing screen of the admin section: only the screens this user may open (spec 8.1). */
export function HomePage() {
  const access = useCatalogSnapshot()?.access;
  const screens = allowedScreens(access);
  const counts = useLoaderData<Awaited<ReturnType<typeof loader>> | null>()?.counts ?? {};
  return (
    <>
      <PageHeader title="ניהול" lead="המסכים שמותרים לך, ועבודה שממתינה לטיפול." />
      {access && !screens.length && (
        <Notice tone="info" title="אין לך מסכי ניהול.">
          המסכים כאן מיועדים לעורכים, למנהלי יחידות, למבקרים ולמנהל המערכת.
        </Notice>
      )}
      <Cards
        title="ממתין לטיפול"
        screens={screens.filter((s) => s.group === 'work')}
        counts={counts}
      />
      <Cards title="כלים" screens={screens.filter((s) => s.group === 'tools')} counts={counts} />
    </>
  );
}

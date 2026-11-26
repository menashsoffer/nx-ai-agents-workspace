import { useState, type SyntheticEvent } from 'react';
import { Link, redirect, useLoaderData, useNavigate } from 'react-router';
import { overview as adminOverview } from '../home-page.tsx';
import { allowedScreens } from '../screens.ts';
import { getAdminSession, identity, rpc, type Identity } from '../../data/rpc.ts';
import { useCatalogSnapshot } from '../../data/react-catalog.ts';
import { IconButton } from '../../ui/icon-button.tsx';
import { Notice } from '../../ui/notice.tsx';
import { QuickActions } from './components/quick-actions.tsx';
import { RegistryState } from './components/registry-state.tsx';
import { WaitingList } from './components/waiting-list.tsx';
import {
  homeSchema,
  waitingItems,
  waitingLead,
  type AdminCounts,
  type HomeOverview,
} from './model/overview.ts';
import { busiestRegistries, greeting } from './model/popular.ts';
import styles from './home.module.css';

interface HomeData {
  who: Identity;
  home: HomeOverview | null;
  counts: AdminCounts;
}

/** The overview is a convenience: if it cannot be read, the screen shows without it. */
async function homeOverview(): Promise<HomeOverview | null> {
  try {
    return await rpc('home_overview', {}, homeSchema);
  } catch {
    return null;
  }
}

/** Only active staff have a home screen; everyone else goes to the catalog's own explanation. */
export async function loader(): Promise<HomeData | Response> {
  if (!getAdminSession()) return redirect('/catalog');
  const who = await identity();
  if (who.access.state !== 'active' || !(who.access.member || who.access.admin))
    return redirect('/catalog');
  const [home, counts] = await Promise.all([homeOverview(), adminOverview()]);
  return { who, home, counts };
}

function SupplierSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void navigate('/catalog', { state: { query } });
  };
  return (
    <search>
      {/* The magnifier inside the box, not a text button (Menash, 26.11.2026). */}
      <form className={styles.search} onSubmit={submit}>
        <input
          type="search"
          dir="auto"
          aria-label="חיפוש ספק"
          placeholder="שם ספק, שם קודם או תחום, למשל: הדרכה"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
          }}
        />
        <IconButton type="submit" icon="search" label="חיפוש" />
      </form>
    </search>
  );
}

/** The registries with the most suppliers, once the catalog has loaded; nothing before. */
function PopularChips() {
  const suppliers = useCatalogSnapshot()?.suppliers ?? [];
  const busiest = busiestRegistries(suppliers);
  if (busiest.length === 0) return null;
  return (
    <div className={styles.chips}>
      <span className={styles.muted}>הכי הרבה ספקים:</span>
      {busiest.map((registry) => (
        <Link
          key={registry.id}
          to="/catalog"
          state={{ registry: registry.id }}
          className={styles.chip}
          aria-label={`${registry.name}, ${registry.count.toLocaleString('he-IL')} ספקים`}
        >
          {registry.name}
        </Link>
      ))}
    </div>
  );
}

function Hero({ lead }: { lead: string }) {
  return (
    <section className={[styles.panel, styles.hero].join(' ')} aria-labelledby="home-title">
      <h1 id="home-title" tabIndex={-1} data-volatile>
        {greeting(new Date())}
      </h1>
      <p className={styles.lead}>{lead}</p>
      <SupplierSearch />
      <PopularChips />
    </section>
  );
}

/** The home screen (option B, Menash 26.11.2026): search, the lanes of what waits, the state. */
export function HomePage() {
  const { who, home, counts } = useLoaderData<HomeData>();
  const items = waitingItems(home, allowedScreens(who.access), counts);
  return (
    <div className={styles.home}>
      <div className={styles.layout}>
        <Hero lead={waitingLead(items)} />
        <QuickActions access={who.access} />
        <WaitingList items={items} />
        {home ? (
          <RegistryState overview={home} />
        ) : (
          <div className={styles.state}>
            <Notice tone="info" title="מצב המאגרים לא נטען.">
              אפשר להמשיך לעבוד. המספרים יופיעו בכניסה הבאה.
            </Notice>
          </div>
        )}
      </div>
    </div>
  );
}

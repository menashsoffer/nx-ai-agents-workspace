import { useState } from 'react';
import { Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { EmptyState } from '../../ui/empty-state.tsx';
import { PageHeader } from '../../ui/page-header.tsx';
import { identity } from '../../data/rpc.ts';
import { getCatalogState } from '../../data/site.ts';
import { loadEngagementFor } from './api/engagement.ts';
import { loadSaved, SAVED_KEY, type SavedRequest } from './api/saved.ts';
import { getScreenData } from '../../data/screen-data.ts';
import { useScreenData } from '../../data/react-screen-data.ts';
import { NewRequest } from './components/new-request.tsx';
import { RequestEditor } from './components/request-editor.tsx';
import { SavedRequests } from './components/saved-requests.tsx';
import styles from './components/route-check.module.css';

/** The new request and the saved requests load together (screens-spec-he.md 2). */
export async function loader(args: LoaderFunctionArgs) {
  // One identity() for both: two snapshot loads at once would cancel the first.
  const who = await identity();
  const [engagement, saved] = await Promise.all([
    loadEngagementFor(args, who),
    getScreenData(SAVED_KEY, () => loadSaved(who)),
  ]);
  return { ...engagement, saved };
}

/** Loads the saved list for whoever is signed in now. */
const fetchSaved = async () => loadSaved(await identity());

function unitNames(): Map<string, string> {
  const units = getCatalogState()?.catalog?.units ?? [];
  return new Map(units.map((unit) => [unit.id, unit.name]));
}

/** The request's own unit is always shown, even when it is not one the user saves in now. */
function unitsFor(request: SavedRequest, units: PageData['units'], names: Map<string, string>) {
  if (units.some((unit) => unit.id === request.unit_id)) return units;
  return [...units, { id: request.unit_id, name: names.get(request.unit_id) ?? 'יחידה לא זמינה' }];
}
type PageData = Awaited<ReturnType<typeof loader>>;

export function EngagementPage() {
  const data = useLoaderData<typeof loader>();
  // Follows every save, edit and cancel without running the loader again, which would re-read
  // the picked suppliers (a save empties them) and close the new request's result step.
  const saved = useScreenData(SAVED_KEY, data.saved, fetchSaved);
  const [editing, setEditing] = useState<SavedRequest | null>(null);
  const names = unitNames();
  return (
    <div className={styles.page}>
      <PageHeader
        title="בקשות התקשרות"
        lead="הכלי מחשב מסלול לפי הנתונים שהוזנו. הוא אינו מאשר התקשרות ואינו קובע שספק זכאי."
      />
      {editing && (
        <RequestEditor
          key={editing.id}
          request={editing}
          units={unitsFor(editing, data.units, names)}
          today={data.today}
          close={() => {
            setEditing(null);
          }}
        />
      )}
      {data.suppliers.length ? (
        <NewRequest data={data} />
      ) : (
        <EmptyState title="לא נבחרו ספקים לבקשה חדשה">
          <p>
            בוחרים ספקים ב<Link to="/catalog">איתור ספקים</Link> ולוחצים "הוספה לבקשה".
          </p>
        </EmptyState>
      )}
      {saved.value && (
        <SavedRequests
          requests={saved.value}
          stale={saved.failed}
          units={names}
          today={data.today}
          edit={setEditing}
        />
      )}
    </div>
  );
}

import { useDeferredValue, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { FormField } from '../../../ui/form-field.tsx';
import { LogoDots } from '../../../ui/logo-dots.tsx';
import { StatusMessage } from '../../../ui/status-message.tsx';
import { filterCatalog } from '../../../catalog-filter.ts';
import type { CatalogState } from '../../../data/snapshot.ts';
import { emptyFilters, reconcile, changeFilter } from '../model/filters.ts';
import { linkedFilters, restoreFilters, saveFilters } from '../model/saved-filters.ts';
import { clearFilters, withoutTag } from '../model/filter-groups.ts';
import { FilterControls } from './filter-controls.tsx';
import { ActiveFilters } from './active-filters.tsx';
import { Results } from './results.tsx';
import styles from './catalog.module.css';
import { usage } from '../../../lib/usage-signal.ts';
interface Props {
  state: CatalogState;
  today: string;
}
/** The search survives a visit to a supplier and the way back (supplier page spec, section 3). */
function useSavedFilters(today: string) {
  const location = useLocation();
  const key = location.key;
  const linked: unknown = location.state;
  const state = useState(() => {
    const fresh = emptyFilters(today);
    return restoreFilters(key, fresh) ?? linkedFilters(linked, fresh) ?? fresh;
  });
  const [filters] = state;
  useEffect(() => {
    saveFilters(key, filters);
  }, [key, filters]);
  return state;
}

function SearchBox({ value, change }: { value: string; change: (query: string) => void }) {
  return (
    <FormField
      field={{ label: 'חיפוש ספקים', hint: 'אפשר לחפש בשם ספק, בשם קודם או בתחום.' }}
      input={{
        ...usage('catalog.search'),
        type: 'search',
        value,
        onChange: (e) => {
          change(e.currentTarget.value);
        },
      }}
    />
  );
}

/** A quiet note while the catalog checks for newer data in the background. */
function RefreshStatus({ refreshing }: { refreshing: boolean }) {
  return (
    <StatusMessage>
      {refreshing && (
        <>
          <LogoDots size="small" />
          בודק עדכונים והרשאות…
        </>
      )}
    </StatusMessage>
  );
}

export function CatalogBrowser({ state, today }: Props) {
  const [filters, setFilters] = useSavedFilters(today);
  const current = reconcile(filters, state.suppliers),
    query = useDeferredValue(filters.query);
  const matches = filterCatalog(state.suppliers, { ...current, query });
  return (
    <>
      <RefreshStatus refreshing={state.refreshing} />
      <search aria-label="חיפוש וסינון ספקים" className={styles.searchPanel}>
        <SearchBox
          value={filters.query}
          change={(query) => {
            setFilters({ ...current, query });
          }}
        />
        <FilterControls
          filters={current}
          suppliers={state.suppliers}
          change={(key, value) => {
            setFilters(changeFilter(current, { key, value }, state.suppliers));
          }}
          replace={setFilters}
          count={matches.length}
        />
        <ActiveFilters
          filters={current}
          suppliers={state.suppliers}
          remove={(key) => {
            setFilters(withoutTag(current, key));
          }}
          clear={() => {
            setFilters(clearFilters(current));
          }}
        />
      </search>
      <div aria-busy={query !== filters.query}>
        <Results
          key={`${state.version}:${JSON.stringify({ ...current, query })}`}
          suppliers={matches}
          today={today}
          reset={() => {
            setFilters(emptyFilters(today));
          }}
        />
      </div>
    </>
  );
}

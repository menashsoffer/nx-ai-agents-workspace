import { Button } from '../../../ui/button.tsx';
import { IconButton } from '../../../ui/icon-button.tsx';
import type { Filters } from '../../../catalog-filter.ts';
import type { Supplier } from '../../../catalog-model.ts';
import { activeTags, type ActiveTag } from '../model/filter-groups.ts';
import styles from './catalog.module.css';

interface Props {
  filters: Filters;
  suppliers: Supplier[];
  remove: (key: ActiveTag['key']) => void;
  clear: () => void;
}

/** What is filtered right now, each with its own ×; nothing when no filter is set. */
export function ActiveFilters({ filters, suppliers, remove, clear }: Props) {
  const tags = activeTags(filters, suppliers);
  if (!tags.length) return null;
  return (
    <div className={styles.active}>
      <ul aria-label="מסננים פעילים" className={styles.tags}>
        {tags.map((tag) => (
          <li key={tag.key} className={styles.tag}>
            {tag.text}
            <IconButton
              icon="close"
              size="small"
              className={styles.tagRemove}
              label={`הסרת המסנן ${tag.text}`}
              tip="הסרת המסנן"
              onClick={() => {
                remove(tag.key);
              }}
            />
          </li>
        ))}
      </ul>
      <Button variant="quiet" onClick={clear} data-usage="catalog.clear-filters">
        ניקוי הכול
      </Button>
    </div>
  );
}

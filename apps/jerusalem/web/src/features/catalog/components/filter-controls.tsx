// The filter row (screens-spec-he.md 1): four filters in view and "עוד מסננים" for the rest.
// On a phone the row is one "סינון" button that opens every filter in a bottom sheet.
import { SelectField } from '../../../ui/select-field.tsx';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { useNarrow } from '../../../lib/use-narrow.ts';
import type { Filters } from '../../../catalog-filter.ts';
import type { Supplier } from '../../../catalog-model.ts';
import { optionsFor, type FilterKey, type ToggleKey } from '../model/filters.ts';
import {
  choicesFor,
  clearKeys,
  countSet,
  LABELS,
  MORE,
  PRIMARY,
  TOGGLES,
  type Options,
} from '../model/filter-groups.ts';
import styles from './catalog.module.css';
import { usage } from '../../../lib/usage-signal.ts';

interface Props {
  filters: Filters;
  suppliers: Supplier[];
  change: (key: FilterKey, value: string) => void;
  /** Replaces all filters at once (a display toggle, "ניקוי" in the dialog). */
  replace: (filters: Filters) => void;
  /** How many suppliers match now, for the dialog's main button. */
  count: number;
}
const SHEET = 'catalog-filters';

function Control({ name, options, ...props }: Props & { name: FilterKey; options: Options }) {
  const { filters } = props;
  const choices = choicesFor(name, options);
  const disabled = name === 'subcategory' && (!filters.category || choices.length === 0);
  return (
    <SelectField
      field={{ label: LABELS[name] }}
      select={{
        ...usage(`catalog.filter.${name}`),
        value: filters[name],
        disabled,
        onChange: (e) => {
          props.change(name, e.currentTarget.value);
        },
        children: (
          <>
            <option value="">{disabled ? 'קודם בוחרים קטגוריה' : 'הכול'}</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </>
        ),
      }}
    />
  );
}

function Controls({ keys, ...props }: Props & { keys: readonly FilterKey[] }) {
  const options = optionsFor(props.suppliers, props.filters);
  return keys.map((key) => <Control key={key} name={key} options={options} {...props} />);
}

function Toggles({ filters, replace }: Pick<Props, 'filters' | 'replace'>) {
  const toggle = (key: ToggleKey, value: boolean) => {
    replace({ ...filters, [key]: value });
  };
  return (
    <fieldset className={styles.sheetToggles}>
      <legend>מה עוד להציג</legend>
      {TOGGLES.map(({ key, label }) => (
        <label key={key} className={styles.toggle}>
          <input
            data-usage={`catalog.toggle.${key}`}
            type="checkbox"
            checked={filters[key]}
            onChange={(e) => {
              toggle(key, e.currentTarget.checked);
            }}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function showLabel(count: number): string {
  if (count === 0) return 'אין תוצאות, חזרה לרשימה';
  return count === 1 ? 'הצגת ספק אחד' : `הצגת ${count.toLocaleString('he-IL')} ספקים`;
}

/** The dialog's footer: clear what it holds, and close to the list with the live count. */
function SheetActions({ keys, ...props }: Props & { keys: readonly FilterKey[] }) {
  const set = countSet(props.filters, keys, true);
  return (
    <div className={styles.sheetActions}>
      <Button data-usage="catalog.filters-apply" command={{ target: SHEET, action: 'close' }}>
        {showLabel(props.count)}
      </Button>
      {set > 0 && (
        <Button
          variant="quiet"
          data-usage="catalog.filters-clear"
          onClick={() => {
            props.replace(clearKeys(props.filters, keys));
          }}
        >
          ניקוי המסננים כאן
        </Button>
      )}
    </div>
  );
}

function Sheet({ title, keys, ...props }: Props & { title: string; keys: readonly FilterKey[] }) {
  return (
    <Dialog id={SHEET} title={title}>
      <div className={styles.sheetFilters}>
        <Controls keys={keys} {...props} />
      </div>
      <Toggles filters={props.filters} replace={props.replace} />
      <SheetActions keys={keys} {...props} />
    </Dialog>
  );
}

function Opener({ label, count }: { label: string; count: number }) {
  return (
    <Button
      variant="secondary"
      className={styles.moreButton}
      data-usage="catalog.filters-open"
      command={{ target: SHEET, action: 'show-modal' }}
    >
      {label}
      {count > 0 && ` (${String(count)})`}
    </Button>
  );
}

export function FilterControls(props: Props) {
  const narrow = useNarrow();
  if (narrow) {
    const all = [...PRIMARY, ...MORE];
    return (
      <div className={styles.filterRow}>
        <Opener label="סינון" count={countSet(props.filters, all, true)} />
        <Sheet title="סינון" keys={all} {...props} />
      </div>
    );
  }
  return (
    <div className={styles.filterRow}>
      <div className={styles.filters}>
        <Controls keys={PRIMARY} {...props} />
      </div>
      <Opener label="עוד מסננים" count={countSet(props.filters, MORE, true)} />
      <Sheet title="עוד מסננים" keys={MORE} {...props} />
    </div>
  );
}

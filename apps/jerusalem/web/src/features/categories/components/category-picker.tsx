import { useDeferredValue, useId, useState } from 'react';
import { FormField } from '../../../ui/form-field.tsx';
import { FieldError, RequiredMark } from '../../../ui/field-parts.tsx';
import styles from './request.module.css';

interface Props {
  categories: { id: string; name: string }[];
  /** The category chosen before a failed attempt, so it stays chosen. */
  chosen: string;
  error: string | undefined;
}
const normal = (text: string) => text.normalize('NFKC').toLocaleLowerCase('he').trim();

/** "קישור לקטגוריה קיימת": search the active categories and pick one. */
export function CategoryPicker({ categories, chosen, error }: Props) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(chosen);
  const wanted = normal(useDeferredValue(query));
  const shown = categories.filter((c) => c.id === picked || normal(c.name).includes(wanted));
  const errorId = useId();
  return (
    <>
      <FormField
        field={{ label: 'חיפוש קטגוריה' }}
        input={{
          type: 'search',
          value: query,
          onChange: (e) => {
            setQuery(e.currentTarget.value);
          },
        }}
      />
      <fieldset
        className={styles.choices}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      >
        <legend>
          קטגוריה לקישור
          <RequiredMark />
        </legend>
        {shown.length === 0 && <p>אין קטגוריה שמתאימה לחיפוש.</p>}
        {shown.map((category) => (
          <label key={category.id}>
            <input
              type="radio"
              name="category_id"
              value={category.id}
              checked={picked === category.id}
              onChange={() => {
                setPicked(category.id);
              }}
            />
            {category.name}
          </label>
        ))}
        <FieldError id={errorId} message={error ?? ''} />
      </fieldset>
    </>
  );
}

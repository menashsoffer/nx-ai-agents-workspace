import type { ComponentProps } from 'react';
import type { FieldLabel } from '../lib/field-description.ts';
import { useField } from './use-field.ts';
import { FieldError, FieldInfo, RequiredMark } from './field-parts.tsx';
import styles from './control.module.css';
interface Props {
  field: FieldLabel;
  select: ComponentProps<'select'>;
}
export function SelectField({ field, select }: Props) {
  const state = useField({ field, id: select.id, extra: select['aria-describedby'] });
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={state.id}>
          {field.label}
          {select.required && <RequiredMark />}
        </label>
        {field.info && <FieldInfo id={`${state.id}-hint`} label={field.label} text={field.info} />}
      </div>
      {field.hint && !field.info && (
        <span id={`${state.id}-hint`} className={styles.hint}>
          {field.hint}
        </span>
      )}
      <select
        {...select}
        id={state.id}
        className={styles.control}
        aria-describedby={state.description}
        aria-invalid={!!state.error}
        onBlur={(e) => {
          state.blur(e);
          select.onBlur?.(e);
        }}
        onInvalid={(e) => {
          state.invalid(e);
          select.onInvalid?.(e);
        }}
        onInput={(e) => {
          state.input(e);
          select.onInput?.(e);
        }}
      />
      <FieldError id={`${state.id}-error`} message={state.error} />
    </div>
  );
}

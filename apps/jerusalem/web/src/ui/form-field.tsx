import type { ComponentProps } from 'react';
import type { FieldLabel } from '../lib/field-description.ts';
import { useField } from './use-field.ts';
import { FieldError, FieldInfo, RequiredMark } from './field-parts.tsx';
import styles from './control.module.css';
interface Props {
  field: FieldLabel;
  input: ComponentProps<'input'>;
}
export function FormField({ field, input }: Props) {
  const state = useField({ field, id: input.id, extra: input['aria-describedby'] });
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={state.id}>
          {field.label}
          {input.required && <RequiredMark />}
        </label>
        {field.info && <FieldInfo id={`${state.id}-hint`} label={field.label} text={field.info} />}
      </div>
      {field.hint && !field.info && (
        <span id={`${state.id}-hint`} className={styles.hint}>
          {field.hint}
        </span>
      )}
      <input
        {...input}
        id={state.id}
        className={styles.control}
        aria-describedby={state.description}
        aria-invalid={!!state.error}
        onBlur={(e) => {
          state.blur(e);
          input.onBlur?.(e);
        }}
        onInvalid={(e) => {
          state.invalid(e);
          input.onInvalid?.(e);
        }}
        onInput={(e) => {
          state.input(e);
          input.onInput?.(e);
        }}
      />
      <FieldError id={`${state.id}-error`} message={state.error} />
    </div>
  );
}

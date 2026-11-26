import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { describedBy, type FieldLabel } from '../lib/field-description.ts';

type Control = HTMLInputElement | HTMLSelectElement;
interface Options {
  field: FieldLabel;
  id?: string | undefined;
  extra?: string | undefined;
}
/** Native validation appears on interaction or submit, and clears when the input becomes valid. */
export function useField({ field, id: suppliedId, extra }: Options) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const [nativeError, setError] = useState('');
  const edited = useRef(false);
  const error = field.error ?? nativeError;
  return {
    id,
    error,
    description: describedBy(id, {
      hint: field.hint ?? field.info ?? '',
      error,
      extra: extra ?? '',
    }),
    invalid: (event: SyntheticEvent<Control>) => {
      setError(
        event.currentTarget.validity.valueMissing ? 'יש למלא את השדה.' : 'יש להזין ערך תקין בשדה.',
      );
    },
    blur: (event: SyntheticEvent<Control>) => {
      if (edited.current && !event.currentTarget.validity.valid)
        setError(
          event.currentTarget.validity.valueMissing
            ? 'יש למלא את השדה.'
            : 'יש להזין ערך תקין בשדה.',
        );
    },
    input: (event: SyntheticEvent<Control>) => {
      edited.current = true;
      if (event.currentTarget.validity.valid) setError('');
    },
  };
}

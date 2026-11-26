import { useActionState } from 'react';
import type { z } from 'zod';
import { DataError } from '../../../data/client.ts';
import { errorText } from '../../../data/errors.ts';
import { check, type FieldErrors } from '../../../lib/rules/forms.ts';
import { formValues } from '../model/account-forms.ts';

export interface FormState {
  errors: FieldErrors;
  /** A refusal that belongs to no single field. */
  failure: string;
  sent: boolean;
  /** What was typed, so a refused form shows it again after React resets it. */
  typed: Record<string, string>;
}
const START: FormState = { errors: {}, failure: '', sent: false, typed: {} };

function failureOf(error: unknown): string {
  // Our own checks throw a plain Error with a Hebrew sentence; everything else is described.
  if (error instanceof Error && !(error instanceof DataError)) return error.message;
  return errorText(error);
}

/** Checks the form with its zod schema, then sends it; field errors stay beside their fields. */
export function useAccountForm<T>(schema: z.ZodType<T>, send: (value: T) => Promise<void>) {
  return useActionState(async (_: FormState, form: FormData): Promise<FormState> => {
    const typed = formValues(form);
    const checked = check(schema, typed);
    if (!checked.ok) return { ...START, errors: checked.errors, typed };
    try {
      await send(checked.value);
      return { ...START, sent: true };
    } catch (error) {
      return { ...START, failure: failureOf(error), typed };
    }
  }, START);
}

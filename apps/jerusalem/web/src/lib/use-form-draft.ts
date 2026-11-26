// Keeps an uncontrolled form's fields in a tab draft and puts them back when the form mounts
// again or React resets it after a refused save (state-management-spec-he.md 5.2).
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { clearDraft, readDraft, writeDraft } from './form-draft.ts';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Values = Record<string, string>;
const VALUES = z.record(z.string(), z.string());
const SKIPPED = new Set(['hidden', 'file', 'password', 'submit', 'button', 'reset', 'image']);
/** A pool choice fills the field list on the next render, so values go back in a few rounds. */
const ROUNDS = 3;

function isField(element: Element): element is Field {
  if (element instanceof HTMLInputElement) return !SKIPPED.has(element.type);
  return element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
}
const toggles = (field: Field): field is HTMLInputElement =>
  field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio');
const keyOf = (field: Field) => (toggles(field) ? `${field.name}=${field.value}` : field.name);
const valueOf = (field: Field) => (toggles(field) ? (field.checked ? 'on' : '') : field.value);

function fieldsOf(form: HTMLFormElement): Field[] {
  return [...form.elements].filter(isField).filter((field) => field.name !== '');
}

export function collect(form: HTMLFormElement): Values {
  return Object.fromEntries(fieldsOf(form).map((field) => [keyOf(field), valueOf(field)]));
}

/** Sets a value the way typing would, so React's own change handlers run too. */
function put(field: Field, value: string): void {
  if (toggles(field)) {
    if (field.checked !== (value === 'on')) field.click();
    return;
  }
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Puts back what it can; returns how many fields still differ from the draft. */
export function restore(form: HTMLFormElement, values: Values): number {
  let missing = 0;
  for (const field of fieldsOf(form)) {
    const value = values[keyOf(field)];
    if (value === undefined || valueOf(field) === value) continue;
    if (!field.disabled) put(field, value);
    if (valueOf(field) !== value) missing += 1;
  }
  return missing;
}

/** Ties a form to the tab draft `key`. Call `forgetFormDraft(key)` once the form is saved. */
export function useFormDraft(key: string) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = ref.current;
    if (!form) return undefined;
    let frame = 0;
    let restoring = false;
    const round = (values: Values, left: number) => {
      if (restore(form, values) > 0 && left > 1) {
        frame = requestAnimationFrame(() => {
          round(values, left - 1);
        });
        return;
      }
      restoring = false;
      writeDraft(key, collect(form));
    };
    const start = () => {
      const values = readDraft(key, VALUES);
      if (!values) return;
      restoring = true;
      round(values, ROUNDS);
    };
    const save = () => {
      if (!restoring) writeDraft(key, collect(form));
    };
    // React empties the fields after a form action; the reset runs after this event.
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(start);
    };
    start();
    form.addEventListener('input', save);
    form.addEventListener('change', save);
    form.addEventListener('reset', reset);
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener('input', save);
      form.removeEventListener('change', save);
      form.removeEventListener('reset', reset);
    };
  }, [key]);
  return ref;
}

export const forgetFormDraft = clearDraft;

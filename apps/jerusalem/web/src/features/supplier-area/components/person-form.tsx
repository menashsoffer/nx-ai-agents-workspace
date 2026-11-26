import { useActionState } from 'react';
import { useRevalidator } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { FormActions } from '../../../ui/form-actions.tsx';
import { FormField } from '../../../ui/form-field.tsx';
import { Notice } from '../../../ui/notice.tsx';
import { errorText } from '../../../data/errors.ts';
import { savePerson, type PortalPerson } from '../api/portal.ts';
import styles from './area.module.css';

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

type Name = 'first_name' | 'last_name' | 'job_title' | 'phone';
const FIELDS: {
  name: Name;
  label: string;
  hint?: string;
  maxLength: number;
  autoComplete: string;
  type?: string;
}[] = [
  { name: 'first_name', label: 'שם פרטי', maxLength: 100, autoComplete: 'given-name' },
  { name: 'last_name', label: 'שם משפחה', maxLength: 100, autoComplete: 'family-name' },
  {
    name: 'job_title',
    label: 'התפקיד אצל הספק',
    hint: 'למשל: מנכ"ל, מנהלת חשבונות',
    maxLength: 200,
    autoComplete: 'organization-title',
  },
  { name: 'phone', label: 'טלפון', type: 'tel', maxLength: 80, autoComplete: 'tel' },
];

/** The person's own name and phone (spec 6.9), asked once before any link. */
export function PersonForm({ person }: { person: PortalPerson | null }) {
  const { revalidate } = useRevalidator();
  const [error, action, pending] = useActionState(async (_previous: string, form: FormData) => {
    const input = {
      first_name: text(form, 'first_name'),
      last_name: text(form, 'last_name'),
      job_title: text(form, 'job_title'),
      phone: text(form, 'phone'),
    };
    try {
      await savePerson(input, person !== null);
      await revalidate();
      return '';
    } catch (failure) {
      return errorText(failure);
    }
  }, '');
  return (
    <form action={action} aria-label="הפרטים שלי" className={styles.panel}>
      <h2>הפרטים שלכם</h2>
      <p>כך העירייה תדע מי מטפל בשם הספק.</p>
      {error && <Notice tone="error" title={error} />}
      {FIELDS.map(({ name, label, hint, ...input }) => (
        <FormField
          key={name}
          field={hint ? { label, hint } : { label }}
          input={{ ...input, name, required: true, defaultValue: person?.[name] ?? '' }}
        />
      ))}
      <FormActions>
        <Button type="submit" pending={pending} pendingLabel="שומר…" data-usage="portal.person">
          שמירה והמשך
        </Button>
      </FormActions>
    </form>
  );
}

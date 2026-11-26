import { FormField } from '../../../ui/form-field.tsx';
import type { FieldErrors } from '../../../lib/rules/forms.ts';

interface Props {
  errors: FieldErrors;
  typed: Record<string, string>;
  values?: { first_name: string; last_name: string; job_title: string; phone: string | null };
}

/** Name, job and phone: the same fields in the access request and in "עריכת הפרטים שלי". */
export function PersonFields({ errors, typed, values }: Props) {
  return (
    <>
      <FormField
        field={{ label: 'שם פרטי', error: errors.first_name }}
        input={{
          name: 'first_name',
          required: true,
          autoComplete: 'given-name',
          defaultValue: typed.first_name ?? values?.first_name,
        }}
      />
      <FormField
        field={{ label: 'שם משפחה', error: errors.last_name }}
        input={{
          name: 'last_name',
          required: true,
          autoComplete: 'family-name',
          defaultValue: typed.last_name ?? values?.last_name,
        }}
      />
      <FormField
        field={{ label: 'תפקיד בעירייה', error: errors.job_title }}
        input={{
          name: 'job_title',
          required: true,
          autoComplete: 'organization-title',
          defaultValue: typed.job_title ?? values?.job_title,
        }}
      />
      <FormField
        field={{ label: 'טלפון', hint: 'רשות. למשל 02-6297777', error: errors.phone }}
        input={{
          name: 'phone',
          type: 'tel',
          dir: 'ltr',
          autoComplete: 'tel',
          defaultValue: typed.phone ?? values?.phone ?? '',
        }}
      />
    </>
  );
}

// The period and role in the address, so a view can be reloaded or shared.
import { Form } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { ROLE_NAMES } from '../model/labels.ts';
import { PERIODS, ROLES, type Range } from '../model/range.ts';
import styles from './usage.module.css';

export function Filters({ range }: { range: Range }) {
  return (
    <Form method="get" className={styles.filters} aria-label="תקופה ותפקיד">
      <SelectField
        field={{ label: 'תקופה' }}
        select={{
          name: 'days',
          defaultValue: String(range.days),
          children: PERIODS.map((days) => (
            <option key={days} value={days}>
              {`${String(days)} הימים האחרונים`}
            </option>
          )),
        }}
      />
      <SelectField
        field={{ label: 'תפקיד' }}
        select={{
          name: 'role',
          defaultValue: range.role ?? '',
          children: (
            <>
              <option value="">כל התפקידים</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_NAMES[role]}
                </option>
              ))}
            </>
          ),
        }}
      />
      <Button type="submit" variant="secondary" className={styles.apply}>
        הצגה
      </Button>
    </Form>
  );
}

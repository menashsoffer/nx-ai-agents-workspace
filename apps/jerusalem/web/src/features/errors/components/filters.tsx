// The period and "needs attention" in the address, so a view can be reloaded or shared.
import { Form } from 'react-router';
import { Button } from '../../../ui/button.tsx';
import { SelectField } from '../../../ui/select-field.tsx';
import { PERIODS, type ErrorView } from '../model/period.ts';
import styles from './errors.module.css';

export function Filters({ view }: { view: ErrorView }) {
  return (
    <Form method="get" className={styles.filters} aria-label="תקופה וסינון">
      <SelectField
        field={{ label: 'תקופה' }}
        select={{
          name: 'days',
          defaultValue: view.period.key,
          children: PERIODS.map((period) => (
            <option key={period.key} value={period.key}>
              {period.label}
            </option>
          )),
        }}
      />
      <label className={styles.check}>
        <input type="checkbox" name="urgent" value="1" defaultChecked={view.urgentOnly} />
        רק מה שדורש טיפול
      </label>
      <Button type="submit" variant="secondary" className={styles.apply}>
        הצגה
      </Button>
    </Form>
  );
}

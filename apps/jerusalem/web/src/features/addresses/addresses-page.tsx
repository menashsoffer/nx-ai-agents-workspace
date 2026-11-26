import { Link, useLoaderData } from 'react-router';
import { DataTable } from '../../ui/data-table.tsx';
import { EmptyState } from '../../ui/empty-state.tsx';
import { when } from '../../lib/dates.ts';
import { loadAddresses, type AddressesToCheck } from './api/addresses.ts';

export const loader = loadAddresses;

const RESULTS: Record<string, string> = {
  not_found: 'לא נמצאה',
  approximate: 'נמצאה רק העיר',
};

function Summary({ counts }: Pick<AddressesToCheck, 'counts'>) {
  return (
    <ul aria-label="סיכום">
      <li>
        נמצאו במפה: <bdi>{counts.found}</bdi>
      </li>
      <li>
        נמצאה רק העיר: <bdi>{counts.approximate}</bdi>
      </li>
      <li>
        לא נמצאו: <bdi>{counts.not_found}</bdi>
      </li>
      <li>
        ממתינות לבדיקה: <bdi>{counts.waiting}</bdi>
      </li>
    </ul>
  );
}

function AddressTable({ items }: Pick<AddressesToCheck, 'items'>) {
  return (
    <DataTable
      caption="כתובות לבדיקה"
      columns={[
        { id: 'supplier', label: 'ספק' },
        { id: 'value', label: 'הכתובת כפי שנרשמה' },
        { id: 'result', label: 'תוצאה' },
        { id: 'map', label: 'מה המפה מצאה' },
        { id: 'checked', label: 'נבדקה' },
      ]}
      rows={items.map((item) => ({
        id: item.contact_id,
        cells: {
          supplier: <Link to={`/supplier/${item.supplier_id}`}>{item.supplier_name}</Link>,
          value: <bdi>{item.value}</bdi>,
          result: RESULTS[item.result] ?? item.result,
          map: item.map_label ? <bdi>{item.map_label}</bdi> : '—',
          checked: when(item.checked_at),
        },
      }))}
    />
  );
}

/** Spec 4.6: addresses that the map did not find, for an admin to correct. */
export function AddressesPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <>
      <h1 tabIndex={-1}>כתובות לבדיקה</h1>
      <p>
        כל כתובת של ספק נבדקת מול OpenStreetMap. כתובת שלא נמצאה עדיין מוצגת בעמוד הספק, עם הערה.
        לתיקון: פותחים את הספק, עורכים את הכתובת ושומרים, והיא נבדקת שוב.
      </p>
      <Summary counts={data.counts} />
      {data.items.length ? (
        <AddressTable items={data.items} />
      ) : (
        <EmptyState title="אין כתובות לבדיקה">
          <p>כל הכתובות שנבדקו נמצאו במפה.</p>
        </EmptyState>
      )}
    </>
  );
}

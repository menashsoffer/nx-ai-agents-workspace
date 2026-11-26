import { useLoaderData } from 'react-router';
import { PageHeader } from '../../ui/page-header.tsx';
import { RequiredNote } from '../../ui/field-parts.tsx';
import { DataError } from '../../data/client.ts';
import { identity } from '../../data/rpc.ts';
import { EmptyState } from '../../ui/empty-state.tsx';
import { loadWriteContext } from './api/write.ts';
import { AddForm } from './components/add-form.tsx';

/** Editors only; the database checks the unit grant again when the row is saved. */
export async function loader() {
  const who = await identity();
  if (who.access.state !== 'active' || !who.access.editor) throw new DataError(403);
  return { context: await loadWriteContext() };
}

export function AddSupplierPage() {
  const { context } = useLoaderData<typeof loader>();
  return (
    <>
      <PageHeader
        title="הוספת ספק"
        lead="רשומה חדשה ממתינה לאימות של משתמש אחר."
        back={{ to: '/catalog', label: 'איתור ספקים' }}
      />
      {context.versions.length === 0 ? (
        <EmptyState title="אין מאגר זמין ביחידה שלך">
          <p>אפשר להוסיף ספק רק למאגר של יחידה שבה יש לך הרשאת עריכה.</p>
        </EmptyState>
      ) : (
        <>
          <RequiredNote />
          <AddForm context={context} />
        </>
      )}
    </>
  );
}

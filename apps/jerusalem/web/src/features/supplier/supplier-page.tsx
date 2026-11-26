import { Suspense } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { freshToken, identity, permitted, sessionToken } from '../../data/rpc.ts';
import { getScreenData } from '../../data/screen-data.ts';
import type { ChangeRequest } from '../../data/supplier-changes.ts';
import { detail } from '../../data/site.ts';
import { useScreenData } from '../../data/react-screen-data.ts';
import {
  createSupplierDetailResource,
  supplierKey,
  useCatalogSnapshot,
  useSupplierDetail,
  type SupplierDetailResource,
} from '../../data/react-catalog.ts';
import { Skeleton } from '../../ui/skeleton.tsx';
import { israelToday } from '../../lib/dates.ts';
import { BackButton } from './components/back-button.tsx';
import { SupplierDetails } from './components/supplier-details.tsx';
import { changesKey, loadPendingChanges } from './api/changes.ts';

/** Confirms the session against the server, then starts the detail request before rendering. */
export async function loader({ params }: LoaderFunctionArgs) {
  const who = await identity();
  const id = params.id ?? '';
  // Waiting changes are shown to editors, managers, admins and the auditor only.
  // The detail request starts first, so the short list of changes does not delay it.
  const resource = createSupplierDetailResource(sessionToken(), id, fetchDetail(id));
  const changes: ChangeRequest[] = permitted(who.access, ['editor', 'unit_manager', 'auditor'])
    ? await getScreenData(changesKey(id), fetchChanges(id))
    : [];
  return { resource, changes };
}

/** A list that cannot load (an older database) shows nothing rather than an error page. */
const fetchChanges = (id: string) => () => loadPendingChanges(id).catch(() => []);

/** Each load takes a current token: a save reloads the card long after the visit began. */
const fetchDetail = (id: string) => async () => detail(await freshToken(), id);

interface DetailProps {
  resource: SupplierDetailResource;
  changes: ChangeRequest[];
}
function Detail({ resource, changes }: DetailProps) {
  const loaded = useSupplierDetail(resource);
  // Follows a save on this card (or in another tab) without loading the whole page again.
  const id = resource.supplierId;
  const data = useScreenData(supplierKey(id), loaded, fetchDetail(id)).value;
  const access = useCatalogSnapshot()?.access;
  const editor = access?.state === 'active' && access.editor;
  const admin = access?.state === 'active' && access.admin;
  const pending = useScreenData(changesKey(id), changes, fetchChanges(id)).value;
  return (
    <SupplierDetails
      data={data}
      today={israelToday()}
      editor={editor}
      admin={admin}
      pending={{ changes: pending, userId: resource.userId }}
    />
  );
}

export function SupplierPage() {
  const { resource, changes } = useLoaderData<typeof loader>();
  return (
    <>
      <BackButton />
      <Suspense
        fallback={
          <>
            <h1 tabIndex={-1}>פרטי ספק</h1>
            <Skeleton shape="detail" label="טוען את פרטי הספק…" />
          </>
        }
      >
        <Detail resource={resource} changes={changes} />
      </Suspense>
    </>
  );
}

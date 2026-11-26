import { use, useSyncExternalStore } from 'react';
import { getCatalogState, subscribe, detail } from './site.ts';
import type { SupplierDetail } from './supplier-detail.ts';
import { tokenUserId } from './snapshot.ts';
import { DataError } from './client.ts';
import { getScreenData } from './screen-data.ts';
const serverSnapshot = () => null;
/** The existing catalog remains the single store; React keeps no copy of it. */
export function useCatalogSnapshot() {
  return useSyncExternalStore(subscribe, getCatalogState, serverSnapshot);
}
export interface SupplierDetailResource {
  readonly supplierId: string;
  readonly userId: string | null;
  readonly promise: Promise<SupplierDetail>;
}
/** The supplier card's key in the screen data (state-management-spec-he.md 5.3). */
export const supplierKey = (supplierId: string) => ['supplier', supplierId] as const;

/**
 * Create in a route loader or event, before rendering. A card seen in the last moments comes
 * from memory; the loader still rechecks server access on every visit.
 */
export function createSupplierDetailResource(
  token: string,
  supplierId: string,
  load: () => Promise<SupplierDetail> = () => detail(token, supplierId),
): SupplierDetailResource {
  const promise = getScreenData(supplierKey(supplierId), load);
  // A lazy screen may mount after the request rejects; keep it handled until React reads it.
  void promise.catch(() => undefined);
  return { supplierId, userId: tokenUserId(token), promise };
}
/** Suspend on the loader's stable promise; the route error boundary handles failures. */
export function useSupplierDetail(resource: SupplierDetailResource): SupplierDetail {
  const state = useCatalogSnapshot();
  if (state?.userId !== resource.userId) throw new DataError(401);
  const result = use(resource.promise);
  if (!state.catalog || !state.access?.member || state.access.state !== 'active')
    throw new DataError(403);
  return result;
}

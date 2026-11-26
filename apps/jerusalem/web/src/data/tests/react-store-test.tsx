import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  useCatalogSnapshot,
  createSupplierDetailResource,
  supplierKey,
  useSupplierDetail,
  type SupplierDetailResource,
} from '../react-catalog.ts';
import { createMemoryRouter, RouterProvider, useRouteError } from 'react-router';
import { DataError } from '../client.ts';
import { invalidate } from '../screen-data.ts';
import { loadSnapshot, clearCatalog } from '../site.ts';
import { response, TOKEN, SUPPLIER, requestUrl } from '../../../tests/catalog-fixture.ts';
function CatalogProbe() {
  const state = useCatalogSnapshot();
  return <output aria-label="מצב הקטלוג">{state?.suppliers[0]?.name ?? 'אין מידע'}</output>;
}
function DetailProbe({ resource }: { resource: SupplierDetailResource }) {
  const detail = useSupplierDetail(resource);
  return <h2>{detail.supplier.display_name}</h2>;
}
afterEach(async () => {
  cleanup();
  await clearCatalog();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('React adapters over the existing catalog', () => {
  it('observes the same snapshot and clears it on sign-out', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json(response())));
    render(<CatalogProbe />);
    expect(screen.getByRole('status', { name: 'מצב הקטלוג' }).textContent).toBe('אין מידע');
    await act(async () => {
      await loadSnapshot(TOKEN);
    });
    expect(screen.getByRole('status', { name: 'מצב הקטלוג' }).textContent).toBe('שם נוכחי');
    await act(async () => {
      await clearCatalog();
    });
    expect(screen.getByRole('status', { name: 'מצב הקטלוג' }).textContent).toBe('אין מידע');
  });
  it('suspends on a loader-created promise, reuses a fresh card and reloads a changed one', async () => {
    let requests = 0,
      finish: (() => void) | undefined;
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith('/catalog_snapshot'))
        return Promise.resolve(Response.json(response()));
      requests++;
      return new Promise<Response>((resolve) => {
        finish = () => {
          resolve(Response.json({ identifiers: [], contacts: [], audit: null }));
        };
      });
    });
    await loadSnapshot(TOKEN);
    const resource = createSupplierDetailResource(TOKEN, SUPPLIER);
    await act(async () => {
      render(
        <Suspense fallback={<p role="status">טוען פרטי ספק</p>}>
          <DetailProbe resource={resource} />
        </Suspense>,
      );
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toBe('טוען פרטי ספק');
    await vi.waitFor(() => {
      expect(requests).toBe(1);
    });
    await act(async () => {
      finish?.();
      await resource.promise;
    });
    expect(await screen.findByRole('heading', { name: 'שם נוכחי' })).toBeDefined();
    cleanup();
    // A visit moments later shows the card from memory, without asking the server again.
    await createSupplierDetailResource(TOKEN, SUPPLIER).promise;
    expect(requests).toBe(1);
    // After a save marks the card changed, the next visit loads it again.
    await invalidate(supplierKey(SUPPLIER));
    const second = createSupplierDetailResource(TOKEN, SUPPLIER);
    expect(second.promise).not.toBe(resource.promise);
    await vi.waitFor(() => {
      expect(requests).toBe(2);
    });
    finish?.();
    await second.promise;
  });
  it('removes displayed detail as soon as the catalog session is cleared', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
      Promise.resolve(
        Response.json(
          requestUrl(input).endsWith('/catalog_snapshot')
            ? response()
            : { identifiers: [], contacts: [], audit: null },
        ),
      ),
    );
    await loadSnapshot(TOKEN);
    const resource = createSupplierDetailResource(TOKEN, SUPPLIER);
    await resource.promise;
    function ErrorNotice() {
      const error = useRouteError();
      return <p role="alert">{error instanceof DataError ? String(error.status) : 'unexpected'}</p>;
    }
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <Suspense fallback={<p role="status">טוען</p>}>
            <DetailProbe resource={resource} />
          </Suspense>
        ),
        errorElement: <ErrorNotice />,
      },
    ]);
    await act(async () => {
      render(<RouterProvider router={router} />);
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { name: 'שם נוכחי' })).toBeDefined();
    await act(async () => {
      await clearCatalog();
    });
    expect((await screen.findByRole('alert')).textContent).toBe('401');
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

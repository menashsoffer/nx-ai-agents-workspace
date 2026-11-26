// The add-supplier form keeps what was typed for the tab (state-management-spec-he.md 5.2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { compactCatalog } from '../../../data/compact-catalog.ts';
import { writableVersions, type WriteContext } from '../../../data/write-context.ts';
import * as rpc from '../../../data/rpc.ts';
import * as site from '../../../data/site.ts';
import { access, wireCatalog } from '../../../../tests/catalog-fixture.ts';
import { AddForm } from '../components/add-form.tsx';

function context(): WriteContext {
  const catalog = compactCatalog(wireCatalog());
  const editor = access({ editor: true, grants: [{ role: 'editor', unitId: 'u1' }] });
  return { catalog, identifiers: [], versions: writableVersions(catalog, editor) };
}

function show() {
  const router = createMemoryRouter([
    { path: '/', element: <AddForm context={context()} />, loader: () => null },
  ]);
  render(<RouterProvider router={router} />);
}

function mockWrites() {
  vi.spyOn(rpc, 'freshToken').mockResolvedValue('token');
  vi.spyOn(site, 'loadSnapshot').mockResolvedValue(
    {} as Awaited<ReturnType<typeof site.loadSnapshot>>,
  );
}

const name = () => screen.findByRole<HTMLInputElement>('textbox', { name: /שם הספק/ });
const pool = () => screen.getByRole<HTMLSelectElement>('combobox', { name: /מאגר וגרסה/ });
const field = () => screen.getByRole<HTMLSelectElement>('combobox', { name: /תחום/ });

async function fillAll() {
  await userEvent.type(await name(), 'ספק חדש');
  await userEvent.type(screen.getByRole('textbox', { name: /טלפון/ }), '02-5555555');
  await userEvent.selectOptions(pool(), 'v1');
  await userEvent.selectOptions(field(), 'f1');
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('add-supplier draft', () => {
  it('keeps the typed values after the database refuses the save', async () => {
    mockWrites();
    vi.spyOn(site, 'saveMembership').mockRejectedValue(new Error('השרת סירב.'));
    show();
    await fillAll();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הספק' }));
    expect(await screen.findByText('השרת סירב.')).toBeDefined();
    await waitFor(() => {
      expect(field().value).toBe('f1');
    });
    expect((await name()).value).toBe('ספק חדש');
    expect(pool().value).toBe('v1');
  });

  it('fills the form again after leaving the page and coming back', async () => {
    show();
    await fillAll();
    cleanup();
    show();
    await waitFor(() => {
      expect(field().value).toBe('f1');
    });
    expect((await name()).value).toBe('ספק חדש');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /טלפון/ }).value).toBe(
      '02-5555555',
    );
  });

  it('forgets the draft once the supplier is saved', async () => {
    mockWrites();
    vi.spyOn(site, 'saveMembership').mockResolvedValue('ok');
    show();
    await fillAll();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הספק' }));
    expect(await screen.findByText('הספק נוסף וממתין לאימות של משתמש אחר.')).toBeDefined();
    cleanup();
    show();
    expect((await name()).value).toBe('');
    expect(pool().value).toBe('');
  });

  // Menash, 22.11: the error must be seen wherever the page is scrolled, not only at the top.
  it('shows a refused save in the floating message area', async () => {
    mockWrites();
    vi.spyOn(site, 'saveMembership').mockRejectedValue(new Error('השרת סירב.'));
    show();
    await fillAll();
    await userEvent.click(screen.getByRole('button', { name: 'הוספת הספק' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('השרת סירב.');
    expect(alert.closest('[data-floating]')).not.toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as rpc from '../../../data/rpc.ts';
import { RegistryPage } from '../registry-page.tsx';
import { RegistriesPage } from '../registries-page.tsx';
import type { RegistryDetail, RegistryReview } from '../api/registries.ts';

const REGISTRY: RegistryDetail = {
  registry_id: 'r',
  name: 'פיתוח המשאב האנושי',
  version_id: 'v',
  document: 'https://example.test/r.pdf',
  valid_from: '2024-01-01',
  valid_until: null,
  members: [
    {
      id: 'm1',
      supplier_id: 's1',
      supplier: 'אלפא בע"מ',
      name_as_published: 'אלפא',
      field: 'הדרכה',
      source_page: 4,
      registered_until: null,
      review_status: 'needs_review',
      note: null,
    },
  ],
};
const REVIEW: RegistryReview = {
  registry_id: 'r',
  name: REGISTRY.name,
  unit: null,
  version_id: 'v',
  document: null,
  valid_from: null,
  valid_until: '2026-12-24',
  counts: { needs_review: 1, verified: 2, rejected: 0, expired: 0 },
};

function show(Component: () => React.ReactNode, data: unknown) {
  const router = createMemoryRouter([{ id: 'page', path: '/', Component, loader: () => data }], {
    hydrationData: { loaderData: { page: data } },
  });
  render(<RouterProvider router={router} />);
  for (const dialog of document.querySelectorAll('dialog')) dialog.setAttribute('open', '');
}
function answer(handler: (name: string, args: unknown) => unknown) {
  return vi
    .spyOn(rpc, 'rpc')
    .mockImplementation((name, args, schema) => Promise.resolve(schema.parse(handler(name, args))));
}
beforeEach(() => {
  vi.spyOn(rpc, 'requireRoles').mockResolvedValue({} as rpc.Identity);
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('registry verification', () => {
  it('lists each registry with its validity and how much was checked', () => {
    show(RegistriesPage, { reviews: [REVIEW] });
    const table = screen.getByRole('table', { name: 'מאגרים לאימות' });
    expect(within(table).getByRole('link', { name: REVIEW.name })).toBeDefined();
    expect(within(table).getByText('בתוקף עד 24.12.2026')).toBeDefined();
    expect(within(table).getByText('2 מתוך 3 נבדקו')).toBeDefined();
  });

  it('verifies one supplier at a time', async () => {
    const call = answer((name) => (name === 'registry_review' ? REGISTRY : null));
    show(RegistryPage, { version: 'v', registry: REGISTRY });
    await userEvent.click(screen.getByRole('button', { name: 'מופיע במסמך' }));
    expect(call).toHaveBeenCalledWith(
      'decide_membership',
      { membership: 'm1', approve: true, note: null },
      expect.anything(),
    );
  });

  it('rejects only with a reason', async () => {
    const call = answer((name) => (name === 'registry_review' ? REGISTRY : null));
    show(RegistryPage, { version: 'v', registry: REGISTRY });
    const dialog = screen.getByRole('dialog', { name: /דחיית אלפא/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'דחייה' }));
    expect(within(dialog).getByText('צריך לכתוב למה הספק לא תואם למסמך.')).toBeDefined();
    await userEvent.type(within(dialog).getByLabelText(/סיבה/), 'לא מופיע במסמך');
    await userEvent.click(within(dialog).getByRole('button', { name: 'דחייה' }));
    expect(call).toHaveBeenCalledWith(
      'decide_membership',
      { membership: 'm1', approve: false, note: 'לא מופיע במסמך' },
      expect.anything(),
    );
  });

  it('saves the registry valid-until', async () => {
    const call = answer((name) => (name === 'registry_review' ? REGISTRY : null));
    show(RegistryPage, { version: 'v', registry: REGISTRY });
    const form = screen.getByRole('form', { name: 'תוקף המאגר' });
    await userEvent.type(within(form).getByLabelText(/בתוקף עד/), '2026-12-24');
    await userEvent.click(within(form).getByRole('button', { name: 'שמירת התוקף' }));
    expect(call).toHaveBeenCalledWith(
      'set_registry_validity',
      { version: 'v', valid_until: '2026-12-24' },
      expect.anything(),
    );
    expect(await screen.findByText('התוקף נשמר.')).toBeDefined();
  });
});

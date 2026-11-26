// The supplier page's contact card, copy button and back button.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import type { SupplierDetail } from '../../../data/supplier-detail.ts';
import { BackButton, cameFromCatalog } from '../components/back-button.tsx';
import { ContactCard } from '../components/contact-card.tsx';
import { CopyButton } from '../components/copy-button.tsx';

type Contact = SupplierDetail['contacts'][number];

function contact(id: string, kind: string, value: string): Contact {
  return { id, kind, value, is_valid: true, status: 'current' } as unknown as Contact;
}

function link(name: string): HTMLAnchorElement {
  return screen.getByRole<HTMLAnchorElement>('link', { name });
}

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('contact card', () => {
  it('orders email, address, phones, mobiles and splits a value with two numbers', () => {
    render(
      <ContactCard
        contacts={[
          contact('1', 'phone', '054-1111111'),
          { ...contact('2', 'phone', '054-2244973 054-5990250'), is_valid: false },
          contact('3', 'address', 'יפו 1'),
          contact('4', 'phone', '03-6872787'),
          contact('5', 'email', 'a@b.test'),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    const at = (text: string) => items.findIndex((item) => item.includes(text));
    expect(at('a@b.test')).toBe(0);
    expect(at('יפו 1')).toBe(1);
    expect(at('03-6872787')).toBe(2);
    expect([at('054-1111111'), at('054-2244973'), at('054-5990250')]).toEqual([3, 4, 5]);
    expect(items[3]).toContain('טלפון נייד');
    expect(items[2]).not.toContain('נייד');
    expect(link('054-5990250').href).toBe('tel:0545990250');
    expect(screen.queryByText('ייתכן שאינו תקין')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'העתקת טלפון נייד' })).toHaveLength(3);
  });

  it('links each kind, email before phone, and warns about an invalid value', () => {
    render(
      <ContactCard
        contacts={[
          contact('1', 'website', 'x.test'),
          { ...contact('2', 'email', 'a@b.test'), is_valid: false },
          contact('3', 'address', 'יפו 1'),
          contact('4', 'phone', '02-123-4567'),
          contact('5', 'contact_person', 'דנה'),
          contact('6', 'pager', 'זר'),
          contact('7', 'email', 'not an email'),
        ]}
      />,
    );
    expect(link('02-123-4567').href).toBe('tel:021234567');
    expect(link('a@b.test').href).toBe('mailto:a@b.test');
    expect(link('x.test').target).toBe('_blank');
    expect(link('יפו 1').href).toContain('maps/search');
    expect(link('יפו 1').target).toBe('_blank');
    expect(screen.queryByText('פתיחה ב-Google Maps')).toBeNull();
    expect(screen.getByText('ייתכן שאינו תקין')).toBeDefined();
    expect(screen.getByText('not an email')).toBeDefined();
    expect(screen.getByRole('button', { name: 'העתקת פרט קשר' })).toBeDefined();
    expect(screen.queryByText('אין טלפון במאגר')).toBeNull();
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    const at = (text: string) => items.findIndex((item) => item.includes(text));
    expect(at('a@b.test')).toBeLessThan(at('02-123-4567'));
  });
});

describe('copy button', () => {
  it('says it copied, then clears the bubble', async () => {
    vi.useFakeTimers();
    const write = vi.fn(() => Promise.resolve());
    clipboard(write);
    render(<CopyButton value="02-1" label="טלפון" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'העתקת טלפון' }));
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(write).toHaveBeenCalledWith('02-1');
    expect(screen.getByRole('status').textContent).toBe('הועתק');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('says so when the browser refuses', async () => {
    vi.useFakeTimers();
    clipboard(() => Promise.reject(new Error('denied')));
    render(<CopyButton value="x" label="דוא״ל" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'העתקת דוא״ל' }));
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.getByRole('status').textContent).toBe('ההעתקה נכשלה');
  });
});

describe('back button', () => {
  function open(state: unknown) {
    const router = createMemoryRouter(
      [
        { path: '/catalog', element: <p>הקטלוג</p> },
        { path: '/supplier', element: <BackButton /> },
      ],
      { initialEntries: ['/catalog', { pathname: '/supplier', state }], initialIndex: 1 },
    );
    render(<RouterProvider router={router} />);
  }

  it('knows the catalog state only when it is set', () => {
    expect(cameFromCatalog({ fromCatalog: true })).toBe(true);
    expect(cameFromCatalog(null)).toBe(false);
    expect(cameFromCatalog('fromCatalog')).toBe(false);
  });

  it('goes back to the search results after a search', async () => {
    open({ fromCatalog: true });
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לתוצאות החיפוש' }));
    expect(await screen.findByText('הקטלוג')).toBeDefined();
  });

  it('links to the catalog when opened directly', () => {
    open(null);
    expect(link('לאיתור ספקים').getAttribute('href')).toBe('/catalog');
  });
});

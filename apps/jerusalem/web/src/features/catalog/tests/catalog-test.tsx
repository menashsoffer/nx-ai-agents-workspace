import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { CatalogBrowser } from '../components/catalog-browser.tsx';
import { Results } from '../components/results.tsx';
import { filterCatalog, type Filters } from '../../../catalog-filter.ts';
import { state, suppliers } from './fixture.ts';
import { emptyFilters } from '../model/filters.ts';
const TODAY = '2026-11-16';
function page() {
  const value = state();
  render(
    <MemoryRouter>
      <CatalogBrowser state={value} today={TODAY} />
    </MemoryRouter>,
  );
  return value;
}
beforeEach(() => {
  // jsdom has no native dialog methods; real keyboard/focus behavior is checked in Chromium.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
function detailLinks() {
  return screen
    .queryAllByRole('link', { name: /^פרטי ספק:/ })
    .map((link) => link.getAttribute('href'));
}
async function matchesLegacy(filters: Filters) {
  const expected = filterCatalog(suppliers(), filters).map(
    (s) => `/supplier/${encodeURIComponent(s.id)}`,
  );
  await waitFor(() => {
    expect(detailLinks()).toEqual(expected);
  });
}
describe('React catalog parity', () => {
  it('searches former names through the same normalized model', async () => {
    page();
    await userEvent.type(screen.getByRole('searchbox', { name: 'חיפוש ספקים' }), 'שם קודם');
    await matchesLegacy({ ...emptyFilters(TODAY), query: 'שם קודם' });
    expect(screen.getByRole('link', { name: 'פרטי ספק: שם נוכחי' })).toBeDefined();
  });
  it('applies registry, field, root, child, unit and validity filters and resets dependencies', async () => {
    page();
    await userEvent.click(screen.getByRole('button', { name: 'עוד מסננים' }));
    const selected = {
      ...emptyFilters(TODAY),
      registry: 'r1',
      field: 'f1',
      category: 'root',
      subcategory: 'c1',
      unit: 'u1',
      validity: 'valid' as const,
    };
    for (const [label, value] of [
      ['מאגר', 'r1'],
      ['תחום', 'f1'],
      ['קטגוריה', 'root'],
      ['תת־קטגוריה', 'c1'],
      ['יחידה', 'u1'],
      ['תוקף', 'valid'],
    ] as const) {
      await userEvent.selectOptions(screen.getByRole('combobox', { name: label }), value);
    }
    await matchesLegacy(selected);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'מאגר' }), 'r2');
    await matchesLegacy({ ...emptyFilters(TODAY), registry: 'r2', validity: 'valid' });
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'תחום' }).value).toBe('');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'תת־קטגוריה' }).disabled).toBe(
      true,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'תוקף' }), 'expired');
    await matchesLegacy({ ...emptyFilters(TODAY), registry: 'r2', validity: 'expired' });
  });
  it('shows an empty result and clears both search and filters', async () => {
    page();
    await userEvent.type(screen.getByRole('searchbox', { name: 'חיפוש ספקים' }), 'לא קיים');
    expect(await screen.findByRole('heading', { name: 'לא נמצאו ספקים' })).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'ניקוי החיפוש והמסננים' }));
    await matchesLegacy(emptyFilters(TODAY));
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('');
  });
  it('renders all progressive batches and retains keyboard links below the first batch', async () => {
    const [first] = suppliers();
    if (!first) throw Error('missing fixture');
    const many = Array.from({ length: 250 }, (_, i) => ({
      ...first,
      id: String(i),
      name: `ספק ${String(i)}`,
    }));
    render(
      <MemoryRouter>
        <Results suppliers={many} today={TODAY} />
      </MemoryRouter>,
    );
    expect(detailLinks()).toHaveLength(100);
    await waitFor(() => {
      expect(detailLinks()).toHaveLength(250);
    });
    expect(screen.getByRole('list', { name: 'ספקים' }).getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('link', { name: 'פרטי ספק: ספק 249' }).getAttribute('href')).toBe(
      '/supplier/249',
    );
  });
  it('keeps the card to the name and services, and marks an inactive supplier', () => {
    const [first] = suppliers();
    if (!first) throw Error('missing fixture');
    const inactive = {
      ...first,
      name: 'לא פעיל',
      inactive: { reason: 'מונתה לשופטת', source: null, changedOn: '2026-09-01' },
    };
    render(
      <MemoryRouter>
        <Results suppliers={[inactive]} today={TODAY} />
      </MemoryRouter>,
    );
    const card = screen.getByRole('article');
    expect(within(card).queryByRole('button')).toBeNull();
    expect(card.textContent).not.toMatch(/ח\.פ\.|במאגר/u);
    expect(within(card).getByText('לא פעיל', { selector: 'span' })).toBeDefined();
    expect(within(card).getByRole('note').textContent).toContain('מונתה לשופטת');
  });
});

describe('filter row', () => {
  it('shows active filters as tags that remove one filter, and clears all but the search', async () => {
    page();
    await userEvent.type(screen.getByRole('searchbox', { name: 'חיפוש ספקים' }), 'ספק');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'תוקף' }), 'valid');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'מאגר' }), 'r1');
    const tags = screen.getByRole('list', { name: 'מסננים פעילים' });
    // The tag's own text; the remove button's name bubble is hidden until hover.
    expect([...tags.querySelectorAll('li')].map((li) => li.firstChild?.textContent)).toEqual([
      expect.stringMatching(/^מאגר: /u),
      'תוקף: בתוקף',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'הסרת המסנן תוקף: בתוקף' }));
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'תוקף' }).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'ניקוי הכול' }));
    expect(screen.queryByRole('list', { name: 'מסננים פעילים' })).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('ספק');
  });

  it('counts the filters set behind "עוד מסננים"', async () => {
    page();
    await userEvent.click(screen.getByRole('button', { name: 'עוד מסננים' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'להציג גם ספקים לא פעילים' }));
    await userEvent.click(screen.getByRole('button', { name: /^הצגת (ספק אחד|[\d,]+ ספקים)$/ }));
    expect(screen.getByRole('button', { name: 'עוד מסננים (1)' })).toBeDefined();
    expect(screen.getByText('כולל לא פעילים')).toBeDefined();
  });

  it('shows the live count on the dialog button and clears only what the dialog holds', async () => {
    page();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'תוקף' }), 'valid');
    await userEvent.click(screen.getByRole('button', { name: 'עוד מסננים' }));
    expect(screen.queryByRole('button', { name: 'ניקוי המסננים כאן' })).toBeNull();
    const count = filterCatalog(suppliers(), { ...emptyFilters(TODAY), validity: 'valid' }).length;
    const label = count === 1 ? 'הצגת ספק אחד' : `הצגת ${String(count)} ספקים`;
    expect(screen.getByRole('button', { name: label })).toBeDefined();
    await userEvent.click(screen.getByRole('checkbox', { name: 'להציג גם ספקים לא פעילים' }));
    await userEvent.click(screen.getByRole('button', { name: 'ניקוי המסננים כאן' }));
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'להציג גם ספקים לא פעילים' }).checked,
    ).toBe(false);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'תוקף' }).value).toBe('valid');
  });

  it('asks for a category before the subcategory list opens', async () => {
    page();
    await userEvent.click(screen.getByRole('button', { name: 'עוד מסננים' }));
    const sub = screen.getByRole<HTMLSelectElement>('combobox', { name: 'תת־קטגוריה' });
    expect(sub.disabled).toBe(true);
    expect(within(sub).getByRole('option', { name: 'קודם בוחרים קטגוריה' })).toBeDefined();
  });

  it('turns the row into one "סינון" button on a phone', async () => {
    const list = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => list),
    );
    page();
    expect(screen.queryByRole('combobox', { name: 'מאגר' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'סינון' }));
    expect(screen.getByRole('combobox', { name: 'מאגר' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'מתקנים ואולמות' })).toBeDefined();
    vi.unstubAllGlobals();
  });
});

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// The page's own code runs as text, since the browser tests are typed without the DOM library.
const WIDTHS = '[document.documentElement.scrollWidth, document.documentElement.clientWidth]';

/** The page is no wider than the screen: nothing is cut off or needs a sideways scroll. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const [width, screen] = await page.evaluate<[number, number]>(WIDTHS);
  expect(width, 'the page is wider than the screen').toBeLessThanOrEqual(screen);
}

/**
 * No button shows a saving state that nobody started (the stuck "שומר…" of 25.11.2026).
 * Buttons and links without a name are axe's button-name and link-name rules.
 */
export async function expectNothingSaving(page: Page): Promise<void> {
  await expect(page.locator('[data-pending]'), 'a button is saving without a press').toHaveCount(0);
}

/** Accessibility by axe-core: names, labels, roles and colour contrast (WCAG 2.2 AA). */
export async function expectAccessible(page: Page, within?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
  if (within) builder = builder.include(within);
  const { violations } = await builder.analyze();
  const found = violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(found, 'accessibility problems found by axe').toEqual([]);
}

/**
 * All the checks, then the picture compared with the approved one in e2e/screens/baseline.
 * `within` is the CSS selector of an open dialog, to check and photograph only that.
 */
export async function checkScreen(page: Page, name: string, within?: string): Promise<void> {
  await page.evaluate('document.fonts.ready.then(() => true)');
  await expectNoSidewaysScroll(page);
  await expectNothingSaving(page);
  await expectAccessible(page, within);
  const options = { mask: [page.locator('[data-volatile]')] };
  if (within) await expect(page.locator(within)).toHaveScreenshot(`${name}.png`, options);
  else await expect(page).toHaveScreenshot(`${name}.png`, { ...options, fullPage: true });
}

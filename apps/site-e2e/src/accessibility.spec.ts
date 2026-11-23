import { expect, test } from '@playwright/test';

const PAGE_PATHS = ['/', '/about', '/no-such-page'];

for (const path of PAGE_PATHS) {
  test(`page ${path} exposes landmarks and one h1`, async ({ page }) => {
    await page.goto(path);

    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'ראשי' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test(`page ${path} has named controls and explicit image alt text`, async ({
    page,
  }) => {
    await page.goto(path);

    // Decorative images need an explicit (possibly empty) alt attribute.
    await expect(page.locator('img:not([alt])')).toHaveCount(0);
    // Every link and button needs an accessible name; Playwright derives the
    // role + name pair the way assistive technology does.
    await expect(page.locator('a:not([href])')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^\s*$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^\s*$/ })).toHaveCount(0);
  });

  test(`page ${path} has a non-empty document title`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveTitle(/\S/);
  });
}

test('keyboard users can reach the navigation and activate a link', async ({
  page,
}) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'ראשי' });

  // The header holds no focusable element before the nav links.
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('link', { name: 'בית' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('link', { name: 'אודות' })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/about$/);
});

test('the new-tab link announces that it opens a new tab', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: /מפת קוד/ })).toContainText(
    'נפתח בלשונית חדשה',
  );
});

import { expect, test } from '@playwright/test';

test('home page renders in Hebrew RTL', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'NX AI Pipeline',
  );
});

test('unknown routes show the not-found page', async ({ page }) => {
  await page.goto('/no-such-page');

  await expect(
    page.getByRole('heading', { name: 'הדף לא נמצא' }),
  ).toBeVisible();
});

test('home page offers the code map link in a new tab', async ({ page }) => {
  await page.goto('/');

  const link = page.getByRole('link', { name: /מפת קוד/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/code-map/');
  await expect(link).toHaveAttribute('target', '_blank');
});

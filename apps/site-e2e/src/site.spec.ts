import { expect, test } from '@playwright/test';

test('home page renders in Hebrew RTL', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'ברוכים הבאים',
  );
});

test('unknown routes show the not-found page', async ({ page }) => {
  await page.goto('/no-such-page');

  await expect(
    page.getByRole('heading', { name: 'הדף לא נמצא' }),
  ).toBeVisible();
});

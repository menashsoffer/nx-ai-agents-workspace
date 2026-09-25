import { expect, test } from '@playwright/test';

test('home page renders in Hebrew RTL', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'NX AI Pipeline',
  );

  const exampleLink = page.getByRole('link', { name: 'דוגמה' });
  await expect(exampleLink).toBeVisible();
  await expect(exampleLink).toHaveAttribute('href', 'https://example.com');
  await expect(exampleLink).toHaveAttribute('target', '_blank');
  await expect(exampleLink).toHaveAttribute('rel', /noopener/);
  await expect(exampleLink).toHaveAttribute('rel', /noreferrer/);
});

test('unknown routes show the not-found page', async ({ page }) => {
  await page.goto('/no-such-page');

  await expect(
    page.getByRole('heading', { name: 'הדף לא נמצא' }),
  ).toBeVisible();
});

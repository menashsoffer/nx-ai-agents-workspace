import { expect, test } from '@playwright/test';

test('about page renders its Hebrew content in the RTL shell', async ({
  page,
}) => {
  await page.goto('/about');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('אודות');
  await expect(page.getByRole('main')).toContainText('ניתוב בין דפים');
});

test('about page has no broken images or console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const brokenImageCount = await page
    .locator('img')
    .evaluateAll(
      (images) =>
        images.filter(
          (image) =>
            !(image as HTMLImageElement).complete ||
            (image as HTMLImageElement).naturalWidth === 0,
        ).length,
    );
  expect(brokenImageCount).toBe(0);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

import { expect, test } from '@playwright/test';

// After every deploy: the published site loads without script errors and offers the sign-in.
test('the published site opens the sign-in for a visitor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: 'כניסה והרשאות' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('form', { name: 'כניסה עם קישור לדוא״ל' })).toBeVisible();
  expect(errors).toEqual([]);
});

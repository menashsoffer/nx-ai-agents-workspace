import { devices, expect, test } from '@playwright/test';

test.use({ ...devices['Pixel 7'] });

test('home page fits a phone screen without horizontal scrolling', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('navigation stays reachable and usable on a phone', async ({ page }) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'ראשי' });
  await expect(navigation).toBeVisible();

  await navigation.getByRole('link', { name: 'אודות' }).tap();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('אודות');
});

test('the layout stays in the viewport and RTL on a phone', async ({
  page,
}) => {
  await page.goto('/about');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const mainBox = await page.getByRole('main').boundingBox();
  if (!mainBox) throw new Error('main landmark has no bounding box');
  expect(mainBox.x).toBeGreaterThanOrEqual(0);
  expect(mainBox.x + mainBox.width).toBeLessThanOrEqual(viewportWidth);
});

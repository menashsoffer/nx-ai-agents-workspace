import { expect, test } from '@playwright/test';

test('navigating between pages keeps the shell and marks the active link', async ({
  page,
}) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'ראשי' });
  await expect(navigation.getByRole('link', { name: 'בית' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await navigation.getByRole('link', { name: 'אודות' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('אודות');
  await expect(navigation.getByRole('link', { name: 'אודות' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    navigation.getByRole('link', { name: 'בית' }),
  ).not.toHaveAttribute('aria-current', 'page');

  await navigation.getByRole('link', { name: 'בית' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'NX AI Pipeline',
  );
});

test('browser back and forward walk through the visited pages', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'אודות' }).click();
  await expect(page).toHaveURL(/\/about$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'NX AI Pipeline',
  );

  await page.goForward();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('אודות');
});

test('a deep link renders directly and survives a reload', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('אודות');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('אודות');
});

test('the not-found page links back to the home page', async ({ page }) => {
  await page.goto('/no-such-page');
  await page.getByRole('link', { name: 'חזרה לדף הבית' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'NX AI Pipeline',
  );
});

test('a nested unknown path also shows the not-found page', async ({
  page,
}) => {
  await page.goto('/about/missing/deeper');

  await expect(
    page.getByRole('heading', { name: 'הדף לא נמצא' }),
  ).toBeVisible();
});

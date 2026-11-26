import { expect, test } from '@playwright/test';
import { signIn } from '../support/accounts.ts';

test('an editor finds a supplier from the home search and adds a phone', async ({ page }) => {
  await signIn(page, 'editor');
  await page.goto('/');
  await page.getByRole('searchbox').fill('חברת דמה');
  await page.getByRole('button', { name: 'חיפוש' }).click();
  await expect(page).toHaveURL(/#\/catalog/);
  await page
    .getByRole('link', { name: /חברת דמה הנדסה/ })
    .first()
    .click();

  await expect(page.getByRole('heading', { level: 1, name: /חברת דמה הנדסה/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /לבדוק|מותר|לא מותר/ })).toBeVisible();

  const phone = `02-${String(Date.now()).slice(-7)}`;
  await page.getByRole('button', { name: 'עריכה' }).click();
  const form = page.getByRole('form', { name: 'עריכת פרטי הספק' });
  await form.getByLabel('פרט קשר חדש').selectOption({ label: 'טלפון' });
  await form.getByLabel('ערך').fill(phone);
  await form.getByRole('button', { name: /שמירה|שליחה לאישור/ }).click();
  await expect(page.getByText(phone).first()).toBeVisible();
});

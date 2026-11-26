import { expect, test } from '@playwright/test';
import { signIn } from '../support/accounts.ts';
import { newAccount } from '../support/db.ts';
import { signInLink } from '../support/mailpit.ts';

test('a new employee signs in by email, asks for access and gets it', async ({ browser }) => {
  const email = `newcomer-${String(Date.now())}@e2e.test`;
  newAccount(email);
  const person = await browser.newPage();

  await person.goto('/#/auth');
  await person.getByRole('textbox', { name: 'דוא״ל' }).fill(email);
  await person.getByRole('button', { name: 'שליחת קישור כניסה' }).click();
  await expect(person.getByText('קישור כניסה נשלח לדוא״ל')).toBeVisible();

  await person.goto(await signInLink(email));
  await person.goto('/#/auth');
  const request = person.getByRole('form', { name: 'בקשת גישה' });
  await request.getByLabel('שם פרטי').fill('נועה');
  await request.getByLabel('שם משפחה').fill('חדשה');
  await request.getByLabel('תפקיד בעירייה').fill('רכזת רכש');
  await request.getByLabel('יחידה').selectOption({ label: 'אגף בדיקות א' });
  await request.getByLabel('למה צריך גישה').fill('איתור יועצים לפרויקט');
  await request.getByRole('button', { name: 'שליחת הבקשה' }).click();
  await expect(person.getByText('וממתינה לאישור מנהל')).toBeVisible();

  const admin = await browser.newPage();
  await signIn(admin, 'admin');
  await admin.goto('/#/users');
  await admin.getByRole('button', { name: 'אישור הגישה' }).first().click();
  const dialog = admin.getByRole('dialog', { name: /אישור הגישה של נועה חדשה/ });
  await dialog.getByRole('button', { name: 'אישור ומתן התפקיד' }).click();
  await expect(dialog).toBeHidden();

  await person.goto('/');
  await expect(person.getByRole('heading', { name: 'מחכה לך' })).toBeVisible();
});

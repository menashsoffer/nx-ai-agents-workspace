// The main screens on a phone and on a desktop (Menash, 25.11.2026): each one must fit the
// screen, name every button, pass axe, and look like its approved picture in baseline/.
// A deliberate change of look: `npm run e2e:screens:update`, then review the new pictures
// in the pull request. documentation/e2e-tests-he.md explains it in Hebrew.
import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../support/accounts.ts';
import { checkScreen } from '../support/screen-checks.ts';

interface Screen {
  name: string;
  path: string;
  /** What shows once the screen has loaded its data. */
  ready: (page: Page) => Promise<void>;
}

const heading = (name: RegExp | string) => async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
};

const SCREENS: Screen[] = [
  {
    name: 'home',
    path: '/',
    ready: async (page) => {
      await heading(/טוב/)(page);
      await expect(page.getByRole('heading', { name: 'מחכה לך' })).toBeVisible();
    },
  },
  {
    name: 'catalog',
    path: '/catalog',
    ready: async (page) => {
      await expect(page.getByRole('link', { name: /חברת דמה הנדסה/ }).first()).toBeVisible();
    },
  },
  { name: 'supplier-new', path: '/supplier/new', ready: heading(/הוספת ספק/) },
  {
    name: 'identifiers',
    path: '/identifiers',
    ready: async (page) => {
      await expect(page.getByText('512345678').first()).toBeVisible();
    },
  },
  { name: 'admin', path: '/admin', ready: heading('ניהול') },
  { name: 'engagement', path: '/engagement', ready: heading(/בקשות/) },
];

test.beforeEach(async ({ page }) => {
  await signIn(page, 'admin');
});

for (const screen of SCREENS) {
  test(`${screen.name} fits, names its buttons, is accessible and looks as approved`, async ({
    page,
  }) => {
    await page.goto(`/#${screen.path}`);
    await screen.ready(page);
    await checkScreen(page, screen.name);
  });
}

test('an identifier candidate opens with its two decision buttons, neither saving', async ({
  page,
}) => {
  await page.goto('/#/identifiers');
  await page.getByText('512345678').first().click();
  const decision = page.getByRole('form', { name: /החלטה על מועמד/ }).first();
  await expect(decision.getByRole('button', { name: 'קבלה לבדיקה נוספת' })).toBeVisible();
  await expect(decision.getByRole('button', { name: 'דחיית המועמד' })).toBeVisible();
  await checkScreen(page, 'identifiers-open');
});

test('the supplier edit dialog keeps save off until a change, and status apart', async ({
  page,
}) => {
  await page.goto('/#/supplier/d6000000-0000-0000-0000-000000000003');
  await page.getByRole('button', { name: 'עריכה' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'שמירה' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'סימון כלא פעיל' })).toBeVisible();
  await checkScreen(page, 'supplier-edit', '#supplier-edit-dialog');
});

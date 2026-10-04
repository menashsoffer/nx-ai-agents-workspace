import { expect, test } from '@playwright/test';
import { watchRequests } from './watch-requests';

// Must match PAGES_BASE_PATH in playwright.config.mts.
const PAGES_BASE_PATH = '/tmpl-smoke/';
const DOCS_PATH = `${PAGES_BASE_PATH}docs/`;

test.describe('docs under the Pages base path', () => {
  test('8: the docs root renders RTL Hebrew and every asset loads same-origin', async ({
    page,
  }) => {
    const requests = watchRequests(page);
    const response = await page.goto(DOCS_PATH);

    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'תיעוד הפרויקט',
    );
    expect(requests.failed).toEqual([]);
    expect(requests.thirdParty).toEqual([]);
  });

  test('9: a deep link is a real page, rendered from docs/', async ({
    page,
  }) => {
    const requests = watchRequests(page);
    const response = await page.goto(`${DOCS_PATH}architecture.html`);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Architecture',
    );
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(requests.failed).toEqual([]);
  });

  test('10: the decisions folder is listed and its README is the overview', async ({
    page,
  }) => {
    await page.goto(`${DOCS_PATH}decisions/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Architecture decision records',
    );
    await page
      .getByRole('link', { name: /^0004\. Serve Pages from the gh-pages/ })
      .click();
    await expect(page).toHaveURL(
      `${DOCS_PATH}decisions/0004-gh-pages-branch-for-previews.html`,
    );
  });

  test('11: sidebar navigation and Back keep the base path', async ({
    page,
  }) => {
    await page.goto(`${DOCS_PATH}architecture.html`);
    await page.getByRole('link', { name: 'קונבנציות' }).first().click();
    await expect(page).toHaveURL(`${DOCS_PATH}conventions.html`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Conventions',
    );

    await page.goBack();
    await expect(page).toHaveURL(`${DOCS_PATH}architecture.html`);
  });

  test('12: the nav leads back to the site and to Storybook from a nested page', async ({
    page,
  }) => {
    const nestedDecisionPageUrl = `${DOCS_PATH}decisions/0004-gh-pages-branch-for-previews.html`;
    await page.goto(nestedDecisionPageUrl);
    await page.getByRole('link', { name: 'האתר', exact: true }).click();
    await expect(page).toHaveURL(PAGES_BASE_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'NX AI Pipeline',
    );

    await page.goto(nestedDecisionPageUrl);
    await page.getByRole('link', { name: 'Storybook', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGES_BASE_PATH}storybook/`));
  });

  test('13: search finds a page from the built index', async ({ page }) => {
    const requests = watchRequests(page);
    await page.goto(DOCS_PATH);
    await page.getByRole('button', { name: 'חיפוש בתיעוד' }).click();
    await page.getByPlaceholder('חיפוש').fill('gh-pages previews');
    await expect(
      page
        .locator('#localsearch-list')
        .getByText(/Serve Pages/)
        .first(),
    ).toBeVisible();
    expect(requests.failed).toEqual([]);
    expect(requests.thirdParty).toEqual([]);
  });

  test('14: code stays left-to-right inside the RTL page', async ({ page }) => {
    await page.goto(`${DOCS_PATH}architecture.html`);
    const direction = await page
      .locator('.vp-doc :not(pre) > code')
      .first()
      .evaluate((code) => getComputedStyle(code).direction);
    expect(direction).toBe('ltr');
  });
});

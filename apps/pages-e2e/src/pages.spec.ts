import { expect, test, type Page } from '@playwright/test';

// Must match BASE in playwright.config.mts.
const BASE = '/tmpl-smoke/';

/** Records failed and cross-origin requests made by a page. */
function watchRequests(page: Page) {
  const failed: string[] = [];
  const thirdParty: string[] = [];
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      response.request().resourceType() !== 'document'
    ) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.protocol.startsWith('http')
    ) {
      thirdParty.push(request.url());
    }
  });
  return { failed, thirdParty };
}

test.describe('site under the Pages base path', () => {
  test('1+2: root renders RTL Hebrew and every asset loads same-origin', async ({
    page,
  }) => {
    const requests = watchRequests(page);
    const response = await page.goto(BASE);

    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'ברוכים הבאים',
    );
    // public/ asset referenced through BASE_URL actually loaded
    const logoWidth = await page
      .locator('header img')
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth);
    expect(logoWidth).toBeGreaterThan(0);

    expect(requests.failed).toEqual([]);
    expect(requests.thirdParty).toEqual([]);
  });

  test('3: a deep-link refresh renders the page through 404.html', async ({
    page,
  }) => {
    const requests = watchRequests(page);
    const response = await page.goto(`${BASE}about`);

    // GitHub Pages answers unknown paths with 404.html and status 404; the SPA
    // then renders the right route. The status is expected (docs/decisions/0003).
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('אודות');
    expect(requests.failed).toEqual([]);
  });

  test('4: an unknown route renders the not-found page', async ({ page }) => {
    await page.goto(`${BASE}no-such-page`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'הדף לא נמצא',
    );
  });

  test('5: client navigation and Back keep the base path', async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole('link', { name: 'אודות' }).click();
    await expect(page).toHaveURL(`${BASE}about`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('אודות');

    await page.goBack();
    await expect(page).toHaveURL(BASE);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'ברוכים הבאים',
    );
  });
});

test.describe('Storybook under the Pages base path', () => {
  test('6: Storybook root loads without failed assets', async ({ page }) => {
    const requests = watchRequests(page);
    const response = await page.goto(`${BASE}storybook/`);

    expect(response?.status()).toBe(200);
    await expect(page.locator('#storybook-preview-iframe')).toBeVisible();
    expect(requests.failed).toEqual([]);
    expect(requests.thirdParty).toEqual([]);
  });

  test('7: a Storybook deep link renders that story', async ({ page }) => {
    await page.goto(`${BASE}storybook/?path=/story/components-button--primary`);
    const story = page.frameLocator('#storybook-preview-iframe');
    await expect(story.getByRole('button', { name: 'לחצו כאן' })).toBeVisible();
  });
});

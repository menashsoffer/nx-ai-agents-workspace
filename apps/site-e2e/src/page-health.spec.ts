import { expect, test } from '@playwright/test';

const PAGE_PATHS = ['/', '/about', '/no-such-page'];

for (const path of PAGE_PATHS) {
  test(`page ${path} has no broken images, console errors or page errors`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(path);
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
}

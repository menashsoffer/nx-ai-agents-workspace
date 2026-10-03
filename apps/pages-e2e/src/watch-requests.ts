import type { Page } from '@playwright/test';

/** Records failed and cross-origin requests made by a page. */
export function watchRequests(page: Page) {
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

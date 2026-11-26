// A short check of the published site right after deploy-web publishes it. No test accounts:
// it only opens the site as a visitor. SMOKE_URL is the published address.
import { defineConfig, devices } from '@playwright/test';
import { env } from './e2e/support/env.ts';

export default defineConfig({
  testDir: 'e2e/smoke',
  testMatch: '*-test.ts',
  retries: 2,
  reporter: 'list',
  use: { baseURL: env('SMOKE_URL'), locale: 'he-IL', ...devices['Desktop Chrome'] },
});

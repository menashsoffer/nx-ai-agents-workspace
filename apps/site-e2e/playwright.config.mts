import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Kept free of @nx/* imports: loading them from an ESM Playwright config
// crashes Nx's native module loader (nx 23.2).
const workspaceRoot = resolve(import.meta.dirname, '../..');
const isCI = !!process.env['CI'];

// Tests run against the production build (vite preview) so what passes here
// is what gets deployed.
const baseURL = process.env['BASE_URL'] || 'http://localhost:4300';

export default defineConfig({
  testDir: './src',
  outputDir: './test-output/playwright/results',
  reporter: [
    [
      'html',
      { outputFolder: './test-output/playwright/report', open: 'never' },
    ],
  ],
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  use: {
    baseURL,
    trace: 'on-first-retry',
    locale: 'he-IL',
  },
  webServer: {
    command: 'pnpm exec nx run site:preview',
    url: baseURL,
    reuseExistingServer: !isCI,
    cwd: workspaceRoot,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Optional: reuse a preinstalled Chromium (e.g. cloud AI sandboxes).
        launchOptions: {
          executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] || undefined,
        },
      },
    },
  ],
});

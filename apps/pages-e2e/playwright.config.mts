import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Tests the assembled GitHub Pages artifact (tools/pages), served the way
// Pages serves a project site, under a deliberately non-root base path.
// Kept free of @nx/* imports (they crash Nx's native loader under ESM).
const workspaceRoot = resolve(import.meta.dirname, '../..');
const isCI = !!process.env['CI'];
export const BASE = '/tmpl-smoke/';
const port = 4400;

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
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    locale: 'he-IL',
  },
  webServer: {
    command: `pnpm pages:build && pnpm pages:serve --port ${port}`,
    url: `http://localhost:${port}${BASE}`,
    env: { BASE_PATH: BASE },
    reuseExistingServer: false,
    timeout: 300_000,
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

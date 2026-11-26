// Browser tests of the main journeys against a local Supabase (`supabase start`).
// documentation/e2e-tests-he.md explains how to run them; CI runs them in tests.yml.
import { defineConfig, devices } from '@playwright/test';
import { env } from './e2e/support/env.ts';

const site = 'http://127.0.0.1:5173';
const build = 'vite build --outDir ../e2e-dist';
const serve = `vite preview --outDir ../e2e-dist --port 5173 --strictPort --host 127.0.0.1`;

// The screen checks run first, before the journeys add data that would change the pictures.
const screens = { testDir: 'e2e/screens' };
const journeys = { testDir: 'e2e/tests', dependencies: ['screens-phone', 'screens-desktop'] };

export default defineConfig({
  testMatch: '*-test.ts',
  globalSetup: './e2e/support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: site,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  // Approved pictures live beside the screen checks, one per screen and device.
  snapshotPathTemplate: 'e2e/screens/baseline/{projectName}/{arg}{ext}',
  expect: {
    // Fonts are bundled, but anti-aliasing differs a little between machines.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  projects: [
    // A phone at scale 1, like the desktop: the pictures are compared in CSS pixels anyway.
    {
      name: 'screens-phone',
      ...screens,
      use: { ...devices['Pixel 7'], deviceScaleFactor: 1 },
    },
    { name: 'screens-desktop', ...screens, use: { viewport: { width: 1280, height: 800 } } },
    { name: 'journeys', ...journeys },
  ],
  webServer: {
    command: `npx ${build} && npx ${serve}`,
    url: site,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: env('E2E_API_URL'),
      VITE_SUPABASE_PUBLISHABLE_KEY: env('E2E_PUBLISHABLE_KEY'),
    },
  },
});

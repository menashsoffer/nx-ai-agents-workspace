/// <reference types="vitest/config" />
import { copyFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin, UserConfig } from 'vite';

export interface AppConfigOptions {
  /** Dev server port. Preview (production build) runs on port + 100. */
  port: number;
}

const workspaceRoot = resolve(import.meta.dirname, '../../../..');

/**
 * GitHub Pages has no SPA rewrites: an unknown path serves 404.html. Shipping
 * a copy of index.html as 404.html lets React Router handle deep links.
 */
export function spaFallback(): Plugin {
  let outDir = '';
  return {
    name: 'spa-fallback-404',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const index = join(outDir, 'index.html');
      if (existsSync(index)) copyFileSync(index, join(outDir, '404.html'));
    },
  };
}

/**
 * Shared Vite + Vitest config for every React app in `apps/`.
 *
 * `BASE_PATH` sets the public base (GitHub Pages project sites live under
 * `/<repo>/`). Locally it defaults to `/`; the deploy workflow sets it.
 */
export function defineAppConfig(
  appRoot: string,
  { port }: AppConfigOptions,
): UserConfig {
  const projectPath = relative(workspaceRoot, appRoot);

  return {
    root: appRoot,
    base: process.env['BASE_PATH'] ?? '/',
    cacheDir: join(workspaceRoot, 'node_modules/.vite', projectPath),
    server: { port, host: 'localhost' },
    preview: { port: port + 100, host: 'localhost' },
    plugins: [react(), tailwindcss(), spaFallback()],
    build: {
      outDir: './dist',
      emptyOutDir: true,
      reportCompressedSize: true,
    },
    test: {
      name: projectPath.split('/').pop(),
      watch: false,
      passWithNoTests: true,
      globals: true,
      environment: 'jsdom',
      include: ['{src,tests}/**/*.{test,spec}.{ts,tsx}'],
      reporters: ['default'],
      coverage: {
        reportsDirectory: './test-output/vitest/coverage',
        provider: 'v8',
      },
    },
  };
}

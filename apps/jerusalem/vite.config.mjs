import { fileURLToPath } from 'node:url';

import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { contentSecurityPolicy } from './web/src/csp.ts';
import { SUPABASE_URL, setting } from './web/src/data/environment.ts';

const page = (name) => fileURLToPath(new URL(`web/${name}`, import.meta.url));

/** Adds the Content-Security-Policy to the built page only; the dev server needs its own scripts. */
function securityPolicy() {
  let policy = '';
  let supabaseUrl = '';
  return {
    name: 'content-security-policy',
    apply: 'build',
    configResolved(config) {
      supabaseUrl = new URL(setting(config.env.VITE_SUPABASE_URL, SUPABASE_URL)).origin;
      policy = contentSecurityPolicy(supabaseUrl);
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: supabaseUrl, crossorigin: '' },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  root: 'web',
  // The release in error reports (error-details-spec-he.md section 3); empty outside CI.
  define: {
    'import.meta.env.VITE_SITE_VERSION': JSON.stringify((process.env.GITHUB_SHA ?? '').slice(0, 7)),
  },
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: { main: page('index.html') },
      // React and the router load on every page, so they stay one chunk. Without this group
      // a new lazy screen can split them into smaller shared chunks and grow the first load.
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
  // React Compiler memoizes components, so code has no manual useMemo (decision 0006).
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), securityPolicy()],
});

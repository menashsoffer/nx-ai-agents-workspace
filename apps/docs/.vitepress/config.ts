import { join, resolve } from 'node:path';
import rtlcss from 'postcss-rtlcss';
import { defineConfig } from 'vitepress';
import { bidiBlocks } from '../src/bidi.ts';
import { readDocEntries } from '../src/docs-source.ts';
import { detectRepoUrl, repoLinks } from '../src/repo-links.ts';
import { buildSidebar } from '../src/sidebar.ts';
import { searchTranslations, themeLabels } from '../src/labels.ts';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const docsDir = join(workspaceRoot, 'docs');
// The site owns `/`, Storybook `/storybook/`; the docs live at `/docs/` under
// the same base path (tools/pages/src/assemble.mjs).
const base = `${(process.env['BASE_PATH'] ?? '/').replace(/\/?$/, '/')}docs/`;
const repoUrl = detectRepoUrl();

// Content stays in the repo's `docs/` folder; this app only renders it.
export default defineConfig({
  lang: 'he',
  dir: 'rtl',
  title: 'תיעוד',
  description: 'ארכיטקטורה, קונבנציות, החלטות, pipeline ואבטחה של הפרויקט',
  base,
  srcDir: '../../docs',
  outDir: './dist',
  cacheDir: join(workspaceRoot, 'node_modules/.vitepress/docs'),
  // GitHub Pages serves `name.html`; extensionless URLs need a rewrite.
  cleanUrls: false,
  lastUpdated: false,
  // Docs mention dev servers (http://localhost:4201); they are not pages.
  ignoreDeadLinks: [/^https?:\/\/localhost(:\d+)?/],
  rewrites: { 'decisions/README.md': 'decisions/index.md' },
  head: [
    [
      'link',
      {
        rel: 'icon',
        href: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%232b60d6%22/%3E%3Cpath d=%22M9 8h10a4 4 0 0 1 0 8H9zm0 8h12a4 4 0 0 1 0 8H9z%22 fill=%22white%22/%3E%3C/svg%3E',
      },
    ],
  ],
  markdown: {
    config: (md) => {
      bidiBlocks(md);
      repoLinks(md, { docsDir, repoRoot: workspaceRoot, repoUrl });
    },
  },
  themeConfig: {
    ...themeLabels,
    nav: [
      { text: 'האתר', link: '/../', target: '_self' },
      { text: 'Storybook', link: '/../storybook/', target: '_self' },
    ],
    sidebar: buildSidebar(readDocEntries(docsDir)),
    search: {
      provider: 'local',
      options: { translations: searchTranslations },
    },
  },
  vite: {
    server: { fs: { allow: [workspaceRoot] } },
    css: {
      // The default theme is written for LTR; this flips its physical
      // properties for `dir="rtl"` (vitepress.dev/guide/rtl).
      postcss: {
        plugins: [
          rtlcss({
            ltrPrefix: ':where([dir="ltr"])',
            rtlPrefix: ':where([dir="rtl"])',
          }),
        ],
      },
    },
  },
});

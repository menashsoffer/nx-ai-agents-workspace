import type { KnipConfig } from 'knip';

/** CSS `@import 'pkg/…'` lines count as imports (e.g. `@starter/ui/styles.css`). */
const cssImports = (text: string) =>
  [...text.matchAll(/@import\s+['"]([^'"]+)['"]/g)]
    .map(([, specifier]) => `import '${specifier}';`)
    .join('\n');

const config: KnipConfig = {
  // D3 (docs/security.md): every declared dependency must be used, and
  // dead files, exports and types fail the same gate (`pnpm verify`, CI).
  compilers: { css: cssImports },
  // `export default X` next to `export X` is deliberate: the app, component
  // and generator templates all emit it (tools/workspace-plugin), so the
  // duplicates report would flag every generated file.
  rules: { duplicates: 'off' },
  workspaces: {
    // Code that runs without an import knip can follow.
    '.': {
      entry: [
        // Run by `pnpm test:pipeline` (`node --test`). pipeline.mjs is found from the
        // workflows already. Not `*.mjs`: knip skips exports of entry files, so
        // pipeline-lib.mjs, github.mjs and router-external.mjs would go unchecked.
        '.github/scripts/*.test.mjs',
        // Called from `.claude/hooks/*.sh`, which knip does not read.
        'scripts/*.mjs',
        // One-off repo scripts (`pnpm template:init`).
        'tools/scripts/*.mjs',
      ],
    },
    // Loaded by Nx through generators.json, not imported.
    'tools/workspace-plugin': {
      entry: ['src/generators/*/*.ts'],
    },
  },
  // Unused exports that stay for now. knip can only scope these by file, so each
  // entry names the exact file and hides only its `exports` findings.
  ignoreIssues: {
    // The app template emits `export default App` beside `export function App`;
    // main.tsx imports the named one.
    'apps/*/src/app/App.tsx': ['exports'],
    // Exported but only used inside their own file. tools/pipeline-map and
    // tools/security are protected paths (AGENTS.md), so un-exporting needs the
    // owner's approval; remove these entries when they are un-exported.
    'tools/pipeline-map/src/model.mjs': ['exports'],
    'tools/pipeline-map/src/workflows.mjs': ['exports'],
    'tools/security/src/audit.mjs': ['exports'],
    'tools/security/src/exceptions.mjs': ['exports'],
    'tools/security/src/manifest.mjs': ['exports'],
    'tools/security/src/scanners.mjs': ['exports'],
  },
  // Used indirectly, which static analysis can't see.
  ignoreDependencies: [
    // Loaded by @nx/eslint-plugin's flat configs (flat/react, flat/typescript).
    '@eslint/js',
    'eslint-plugin-import',
    'eslint-plugin-jsx-a11y',
    'eslint-plugin-react',
    'eslint-plugin-react-hooks',
    'typescript-eslint',
    // Nx plugins resolved by name from nx.json and `nx g` (e.g. @nx/workspace:remove).
    '@nx/devkit',
    '@nx/plugin',
    '@nx/workspace',
    // Peer dependency of @storybook/react-vite.
    '@storybook/react',
    // Runtime helpers for compiled output ("importHelpers": true in tsconfig.base.json).
    'tslib',
  ],
};

export default config;

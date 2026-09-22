import type { KnipConfig } from 'knip';

/** CSS `@import 'pkg/…'` lines count as imports (e.g. `@starter/ui/styles.css`). */
const cssImports = (text: string) =>
  [...text.matchAll(/@import\s+['"]([^'"]+)['"]/g)]
    .map(([, specifier]) => `import '${specifier}';`)
    .join('\n');

const config: KnipConfig = {
  // D3 (docs/security.md): every declared dependency must be used.
  compilers: { css: cssImports },
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

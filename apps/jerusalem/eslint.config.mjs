// Rules mirror documentation/coding-standards-he.md. Change both together.
import { existsSync, readdirSync } from 'node:fs';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { buttonOwners, buttonRestrictions } from './scripts/lint/button-rules.ts';

// Import direction of the React site (documentation/react-guide-he.md, section 1):
// lib <- ui, data <- features <- app-shell. A feature never imports another feature.
const web = './web/src';
const layers = [
  {
    target: `${web}/lib`,
    from: [`${web}/ui`, `${web}/data`, `${web}/features`, `${web}/app-shell`],
  },
  { target: `${web}/ui`, from: [`${web}/data`, `${web}/features`, `${web}/app-shell`] },
  { target: `${web}/data`, from: [`${web}/ui`, `${web}/features`, `${web}/app-shell`] },
  { target: `${web}/features`, from: [`${web}/app-shell`] },
].map((zone) => ({
  ...zone,
  message: 'Imports in the React site go one way: lib, ui, data, features, app-shell.',
}));
const featureDir = new URL('web/src/features/', import.meta.url);
const features = existsSync(featureDir)
  ? readdirSync(featureDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];
const featureZones = features.map(({ name }) => ({
  target: `${web}/features/${name}`,
  from: `${web}/features`,
  except: [`./${name}`],
  message: 'A feature does not import another feature. Move shared code to ui, data or lib.',
}));

export default defineConfig(
  globalIgnores([
    'node_modules/**',
    'dist/**',
    'e2e-dist/**',
    'test-results/**',
    'playwright-report/**',
    'coverage/**',
    'web/src/database.types.ts',
  ]),
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-len': [
        'error',
        { code: 100, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreUrls: true },
      ],
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 3],
      'no-magic-numbers': 'off',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['web/src/**/*.tsx', 'web/src/**/*.ts'],
    extends: [reactHooks.configs.flat['recommended-latest'], jsxA11y.configs.recommended],
    plugins: { 'import-x': importX },
    languageOptions: { globals: globals.browser },
    rules: {
      'import-x/no-restricted-paths': ['error', { zones: [...layers, ...featureZones] }],
      'no-restricted-syntax': ['error', ...buttonRestrictions],
    },
  },
  { files: buttonOwners, rules: { 'no-restricted-syntax': 'off' } },
  {
    files: [
      'supabase/functions/tests/**/*.ts',
      'supabase/tests/**/*.ts',
      'web/tests/**/*.ts',
      '**/tests/**/*-test.ts',
      '**/tests/**/*-test.tsx',
    ],
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);

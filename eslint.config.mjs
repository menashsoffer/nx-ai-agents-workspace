import nx from '@nx/eslint-plugin';
/**
 * Tailwind classes that hard-code a physical side. They break RTL layouts, so
 * use the logical equivalent instead:
 *   ml/mr -> ms/me, pl/pr -> ps/pe, left/right -> start/end,
 *   text-left/right -> text-start/end, rounded-l/r -> rounded-s/e,
 *   border-l/r -> border-s/e, float-left/right -> float-start/end.
 * Matches with or without variants/negation (e.g. `md:-ml-2`).
 */
const PHYSICAL_CLASS =
  '(^|[\\s:"\'`!-])(ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)-|(^|[\\s:"\'`!])(text-left|text-right|float-left|float-right|clear-left|clear-right|border-l|border-r|rounded-l|rounded-r)($|[\\s"\'`])';
const PHYSICAL_MESSAGE =
  'Physical-direction Tailwind class breaks RTL. Use the logical one (ms/me, ps/pe, start/end, text-start/end, rounded-s/e, border-s/e).';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/storybook-static',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      '**/test-output',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // Tags live in each project's package.json under "nx.tags".
      // See docs/conventions.md for what each tag means.
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Product code must never pull in dev-only helpers.
            {
              sourceTag: 'scope:product',
              onlyDependOnLibsWithTags: ['scope:product', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:dev',
              onlyDependOnLibsWithTags: [
                'scope:dev',
                'scope:shared',
                'scope:product',
              ],
            },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:util',
              ],
            },
            {
              sourceTag: 'type:e2e',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:util',
              ],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.tsx', '**/*.jsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${PHYSICAL_CLASS}/]`,
          message: PHYSICAL_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=/${PHYSICAL_CLASS}/]`,
          message: PHYSICAL_MESSAGE,
        },
      ],
    },
  },
  {
    files: ['**/*.json'],
    // Override or add rules here
    rules: {},
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];

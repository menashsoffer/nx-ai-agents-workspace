import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PHYSICAL_CSS_CASES } from './physical-css.cases.js';
import { findPhysicalCssProperties } from './physical-css.scanner.js';

const workspaceRoot = resolve(import.meta.dirname, '../../../../..');

// A computed specifier (not a string literal) keeps this outside-the-project
// file out of TypeScript's composite build graph (it would otherwise fail
// the `rootDir` check), while still importing the live regex at runtime.
const rootEslintConfigUrl = pathToFileURL(
  resolve(workspaceRoot, 'eslint.config.mjs'),
).href;
const { PHYSICAL_CLASS, PHYSICAL_MESSAGE } = (await import(
  rootEslintConfigUrl
)) as {
  PHYSICAL_CLASS: string;
  PHYSICAL_MESSAGE: string;
};

const EXCLUDED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'dist',
  'out-tsc',
  'storybook-static',
  'test-output',
]);

function isExcludedPath(relativePath: string): boolean {
  return relativePath
    .split('/')
    .some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment));
}

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
}

// AGENTS.md "RTL and Hebrew": physical CSS properties break RTL layouts, so
// a logical property (margin-inline-start/end, inset-inline-start/end, ...)
// must be used instead.
describe('findPhysicalCssProperties', () => {
  it.each(PHYSICAL_CSS_CASES)(
    '$category: $cssText',
    ({ cssText, expectedFindings }) => {
      expect(findPhysicalCssProperties(cssText)).toEqual(expectedFindings);
    },
  );
});

describe('CSS logical properties', () => {
  const cssFilePaths = globSync(['libs/**/*.css', 'apps/**/*.css'], {
    cwd: workspaceRoot,
  }).filter((relativePath) => !isExcludedPath(relativePath));

  it('finds CSS files to check', () => {
    expect(cssFilePaths.length).toBeGreaterThan(0);
  });

  it.each(cssFilePaths)(
    '%s uses no physical-direction property',
    (relativePath) => {
      expect(
        findPhysicalCssProperties(readWorkspaceFile(relativePath)),
      ).toEqual([]);
    },
  );
});

// AGENTS.md "RTL and Hebrew": the physical-class ESLint rule in
// eslint.config.mjs must reject every family named in its comment, with and
// without a variant prefix (`md:`) and `-` negation, and accept the logical
// equivalent.
const PHYSICAL_TAILWIND_FAMILIES: {
  physical: string;
  logical: string;
  allowsNegation: boolean;
}[] = [
  { physical: 'ml-4', logical: 'ms-4', allowsNegation: true },
  { physical: 'mr-4', logical: 'me-4', allowsNegation: true },
  { physical: 'pl-4', logical: 'ps-4', allowsNegation: true },
  { physical: 'pr-4', logical: 'pe-4', allowsNegation: true },
  { physical: 'left-0', logical: 'start-0', allowsNegation: true },
  { physical: 'right-0', logical: 'end-0', allowsNegation: true },
  { physical: 'text-left', logical: 'text-start', allowsNegation: false },
  { physical: 'text-right', logical: 'text-end', allowsNegation: false },
  {
    physical: 'rounded-l-lg',
    logical: 'rounded-s-lg',
    allowsNegation: false,
  },
  {
    physical: 'rounded-r-lg',
    logical: 'rounded-e-lg',
    allowsNegation: false,
  },
  { physical: 'border-l-2', logical: 'border-s-2', allowsNegation: false },
  { physical: 'border-r-2', logical: 'border-e-2', allowsNegation: false },
  { physical: 'float-left', logical: 'float-start', allowsNegation: false },
  { physical: 'float-right', logical: 'float-end', allowsNegation: false },
];

describe('Tailwind physical-class ESLint rule', () => {
  const physicalClassPattern = new RegExp(PHYSICAL_CLASS);

  it('documents the rejection as an RTL concern', () => {
    expect(PHYSICAL_MESSAGE).toMatch(/RTL/);
  });

  it.each(PHYSICAL_TAILWIND_FAMILIES)(
    'rejects $physical and accepts $logical',
    ({ physical, logical, allowsNegation }) => {
      expect(physicalClassPattern.test(physical)).toBe(true);
      expect(physicalClassPattern.test(`md:${physical}`)).toBe(true);
      expect(physicalClassPattern.test(logical)).toBe(false);
      expect(physicalClassPattern.test(`md:${logical}`)).toBe(false);

      if (allowsNegation) {
        expect(physicalClassPattern.test(`-${physical}`)).toBe(true);
        expect(physicalClassPattern.test(`md:-${physical}`)).toBe(true);
        expect(physicalClassPattern.test(`-${logical}`)).toBe(false);
      }
    },
  );
});

describe('no React or DOM imports', () => {
  const sourceFilePaths = globSync('libs/shared/utils/src/**/*.{ts,tsx}', {
    cwd: workspaceRoot,
  });

  it('finds source files to check', () => {
    expect(sourceFilePaths.length).toBeGreaterThan(0);
  });

  it.each(sourceFilePaths)(
    '%s does not import React, react-dom or use DOM globals',
    (relativePath) => {
      const sourceText = readWorkspaceFile(relativePath);

      expect(sourceText).not.toMatch(
        /from\s+['"](react|react-dom)(\/[^'"]*)?['"]/,
      );
      expect(sourceText).not.toMatch(/\b(document|window)\./);
    },
  );
});

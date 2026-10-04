import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Internal navigation and public assets must go through the Pages base path
// (see AGENTS.md "Routing and deployment"): either react-router's Link/NavLink
// (basename-aware) or a value built from import.meta.env.BASE_URL. A raw
// href/src that hard-codes a leading "/" breaks on GitHub Pages, where the
// site is served from /<repo>/ (or /<repo>/pr-<n>/ for previews).
const BASE_URL_EXPRESSION = '${import.meta.env.BASE_URL}';

// Matches <a href=...>, <img src=...>, <link href=...> and any src= attribute.
const HREF_OR_SRC_PATTERN =
  /<(\w+)\b[^>]*\b(src|href)=(?:\{\s*)?(["'`])((?:\\.|(?!\3)[\s\S])*)\3/g;
const CSS_URL_PATTERN = /url\(\s*(["']?)(\/[^"')]*)\1\s*\)/g;

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function isRootAbsolutePath(value: string): boolean {
  return value.startsWith('/');
}

function findRoutingPathViolations(
  filePath: string,
  content: string,
): string[] {
  const violations: string[] = [];

  for (const match of content.matchAll(HREF_OR_SRC_PATTERN)) {
    const [, tagName, attributeName, quote, value] = match;
    const isHrefOnNavigableTag =
      attributeName === 'href' &&
      (tagName === 'a' || tagName === 'link' || tagName === 'img');
    if (attributeName === 'href' && !isHrefOnNavigableTag) {
      continue;
    }
    if (quote === '`') {
      if (!value.startsWith(BASE_URL_EXPRESSION)) {
        violations.push(
          `${filePath}:${lineNumberAt(content, match.index)}: <${tagName}> ${attributeName} template literal must start with ${BASE_URL_EXPRESSION}`,
        );
      }
    } else if (isRootAbsolutePath(value)) {
      violations.push(
        `${filePath}:${lineNumberAt(content, match.index)}: <${tagName}> ${attributeName} must not hard-code a root-absolute path`,
      );
    }
  }

  for (const match of content.matchAll(CSS_URL_PATTERN)) {
    violations.push(
      `${filePath}:${lineNumberAt(content, match.index)}: url() must not hard-code a root-absolute path`,
    );
  }

  return violations;
}

function collectSourceFiles(directoryPath: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(spec|test)\.tsx?$/.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

const FIXTURE_CASES: Array<[string, string, number]> = [
  [
    'flags a hard-coded root-absolute <a> href string literal',
    '<a href="/about">about</a>',
    1,
  ],
  [
    'flags an <a> href template literal that does not start with BASE_URL',
    '<a href={`/about`}>about</a>',
    1,
  ],
  [
    'passes an <a> href template literal built from BASE_URL',
    '<a href={`${import.meta.env.BASE_URL}code-map/`}>map</a>',
    0,
  ],
  [
    'passes internal navigation expressed with Link/NavLink',
    '<Link to="/about">about</Link><NavLink to="/">home</NavLink>',
    0,
  ],
  [
    'flags a hard-coded root-absolute img src string literal',
    '<img src="/logo.svg" alt="" />',
    1,
  ],
  [
    'flags a hard-coded root-absolute link href string literal',
    '<link href="/favicon.svg" rel="icon" />',
    1,
  ],
  [
    'passes an img src template literal built from BASE_URL',
    '<img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />',
    0,
  ],
  [
    'passes an asset reference through an import',
    'import logo from \'./logo.svg\';\n<img src={logo} alt="" />',
    0,
  ],
  [
    'flags a CSS url() that hard-codes a root-absolute path',
    "const backgroundImage = 'url(/bg.png)';",
    1,
  ],
  [
    'passes a CSS url() built from BASE_URL',
    'const backgroundImage = `url(${import.meta.env.BASE_URL}bg.png)`;',
    0,
  ],
];

describe('findRoutingPathViolations', () => {
  it.each(FIXTURE_CASES)('%s', (_description, content, violationCount) => {
    expect(findRoutingPathViolations('fixture.tsx', content)).toHaveLength(
      violationCount,
    );
  });
});

describe('apps/site/src', () => {
  it('has no routing-path violations', () => {
    const files = collectSourceFiles(import.meta.dirname);
    const violations = files.flatMap((filePath) =>
      findRoutingPathViolations(filePath, readFileSync(filePath, 'utf8')),
    );
    expect(violations).toEqual([]);
  });
});

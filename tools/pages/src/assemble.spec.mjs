import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from './assemble.mjs';

function createFixtureDirectory(files) {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'pages-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(fixtureDirectory, path, '..'), { recursive: true });
    writeFileSync(join(fixtureDirectory, path), content);
  }
  return fixtureDirectory;
}

const createHtmlPage = (body = '') =>
  `<!doctype html><html><head>${body}</head></html>`;

const createOutputDirectory = () =>
  join(mkdtempSync(join(tmpdir(), 'out-')), 'pages');

/** Minimal valid builds; each can be overridden with fixture files. */
function createBuildDirectories({ site = {}, storybook = {}, docs = {} } = {}) {
  return {
    siteDir: createFixtureDirectory({
      'index.html': createHtmlPage(),
      ...site,
    }),
    storybookDir: createFixtureDirectory({
      'index.html': createHtmlPage(),
      ...storybook,
    }),
    docsDir: createFixtureDirectory({
      'index.html': createHtmlPage(),
      ...docs,
    }),
    outDir: createOutputDirectory(),
  };
}

describe('assemble', () => {
  it('puts the site at the root, Storybook and the docs under their paths', () => {
    const buildDirectories = createBuildDirectories({
      site: { '404.html': createHtmlPage() },
      docs: { 'architecture.html': createHtmlPage() },
    });

    const outDir = assemble(buildDirectories);

    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
    expect(existsSync(join(outDir, '404.html'))).toBe(true);
    expect(existsSync(join(outDir, 'storybook/index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'docs/index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'docs/architecture.html'))).toBe(true);
    expect(readFileSync(join(outDir, '.nojekyll'), 'utf8')).toBe('');
  });

  it('adds nothing at the top level that the deploy would not own', () => {
    const outDir = assemble(createBuildDirectories());
    expect(readdirSync(outDir).sort()).toEqual([
      '.nojekyll',
      'docs',
      'index.html',
      'storybook',
    ]);
  });

  it('refuses a site build that already has storybook/', () => {
    expect(() =>
      assemble(createBuildDirectories({ site: { 'storybook/x.txt': 'x' } })),
    ).toThrow(/reserves for Storybook/);
  });

  it('refuses a site build that already has docs/', () => {
    expect(() =>
      assemble(createBuildDirectories({ site: { 'docs/x.txt': 'x' } })),
    ).toThrow(/reserves for the docs app/);
  });

  it('refuses a site build with a pr-<n>/ path, which belongs to previews', () => {
    expect(() =>
      assemble(createBuildDirectories({ site: { 'pr-12/x.txt': 'x' } })),
    ).toThrow(/"pr-12\/".*PR previews/);
  });

  it('allows other pr- names', () => {
    expect(() =>
      assemble(createBuildDirectories({ site: { 'pr-notes/x.txt': 'x' } })),
    ).not.toThrow();
  });

  it('rejects source maps (P2), also in the docs', () => {
    expect(() =>
      assemble(createBuildDirectories({ site: { 'assets/a.js.map': '{}' } })),
    ).toThrow(/P2/);
    expect(() =>
      assemble(createBuildDirectories({ docs: { 'assets/a.js.map': '{}' } })),
    ).toThrow(/P2: source map in artifact: docs\/assets/);
  });

  it('rejects third-party scripts and styles (P1) in every part', () => {
    const script = createHtmlPage(
      '<script src="https://cdn.example.com/x.js"></script>',
    );
    const style = createHtmlPage(
      '<link rel="stylesheet" href="//cdn.example.com/x.css">',
    );
    expect(() =>
      assemble(
        createBuildDirectories({
          site: { 'index.html': script },
          storybook: { 'index.html': style },
          docs: { 'index.html': script },
        }),
      ),
    ).toThrow(/P1[\s\S]*P1[\s\S]*P1/);
  });

  it.each([
    [
      'spaces around =',
      '<script src = "https://cdn.example.com/x.js"></script>',
    ],
    ['an unquoted value', '<script src=https://cdn.example.com/x.js></script>'],
    [
      'a scheme without // (http:host/path)',
      '<script src="http:cdn.example.com/x.js"></script>',
    ],
    [
      'the placeholder host',
      '<script src="http://pages.invalid/x.js"></script>',
    ],
    [
      'the placeholder host, protocol-relative',
      '<script src=//pages.invalid/x.js></script>',
    ],
    [
      'an unquoted protocol-relative URL',
      '<link rel=stylesheet href=//cdn.example.com/x.css>',
    ],
  ])('rejects a third-party asset written with %s (P1)', (_name, head) => {
    expect(() =>
      assemble(
        createBuildDirectories({
          site: { 'index.html': createHtmlPage(head) },
        }),
      ),
    ).toThrow(/P1: third-party asset in index\.html/);
  });

  it('explains a missing build', () => {
    expect(() =>
      assemble({
        siteDir: createFixtureDirectory({}),
        storybookDir: createFixtureDirectory({}),
        docsDir: createFixtureDirectory({}),
        outDir: createFixtureDirectory({}),
      }),
    ).toThrow(/site build not found/);
    expect(() =>
      assemble({
        ...createBuildDirectories(),
        docsDir: createFixtureDirectory({}),
      }),
    ).toThrow(/docs build not found/);
  });
});

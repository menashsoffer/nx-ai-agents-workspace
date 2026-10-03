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

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'pages-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const html = (body = '') => `<!doctype html><html><head>${body}</head></html>`;

const out = () => join(mkdtempSync(join(tmpdir(), 'out-')), 'pages');

/** Minimal valid builds; each can be overridden with fixture files. */
function builds({ site = {}, storybook = {}, docs = {} } = {}) {
  return {
    siteDir: fixture({ 'index.html': html(), ...site }),
    storybookDir: fixture({ 'index.html': html(), ...storybook }),
    docsDir: fixture({ 'index.html': html(), ...docs }),
    outDir: out(),
  };
}

describe('assemble', () => {
  it('puts the site at the root, Storybook and the docs under their paths', () => {
    const dirs = builds({
      site: { '404.html': html() },
      docs: { 'architecture.html': html() },
    });

    const outDir = assemble(dirs);

    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
    expect(existsSync(join(outDir, '404.html'))).toBe(true);
    expect(existsSync(join(outDir, 'storybook/index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'docs/index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'docs/architecture.html'))).toBe(true);
    expect(readFileSync(join(outDir, '.nojekyll'), 'utf8')).toBe('');
  });

  it('adds nothing at the top level that the deploy would not own', () => {
    const outDir = assemble(builds());
    expect(readdirSync(outDir).sort()).toEqual([
      '.nojekyll',
      'docs',
      'index.html',
      'storybook',
    ]);
  });

  it('refuses a site build that already has storybook/', () => {
    expect(() =>
      assemble(builds({ site: { 'storybook/x.txt': 'x' } })),
    ).toThrow(/reserves for Storybook/);
  });

  it('refuses a site build that already has docs/', () => {
    expect(() => assemble(builds({ site: { 'docs/x.txt': 'x' } }))).toThrow(
      /reserves for the docs app/,
    );
  });

  it('refuses a site build with a pr-<n>/ path, which belongs to previews', () => {
    expect(() => assemble(builds({ site: { 'pr-12/x.txt': 'x' } }))).toThrow(
      /"pr-12\/".*PR previews/,
    );
  });

  it('allows other pr- names', () => {
    expect(() =>
      assemble(builds({ site: { 'pr-notes/x.txt': 'x' } })),
    ).not.toThrow();
  });

  it('rejects source maps (P2), also in the docs', () => {
    expect(() =>
      assemble(builds({ site: { 'assets/a.js.map': '{}' } })),
    ).toThrow(/P2/);
    expect(() =>
      assemble(builds({ docs: { 'assets/a.js.map': '{}' } })),
    ).toThrow(/P2: source map in artifact: docs\/assets/);
  });

  it('rejects third-party scripts and styles (P1) in every part', () => {
    const script = html('<script src="https://cdn.example.com/x.js"></script>');
    const style = html(
      '<link rel="stylesheet" href="//cdn.example.com/x.css">',
    );
    expect(() =>
      assemble(
        builds({
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
      assemble(builds({ site: { 'index.html': html(head) } })),
    ).toThrow(/P1: third-party asset in index\.html/);
  });

  it('explains a missing build', () => {
    expect(() =>
      assemble({
        siteDir: fixture({}),
        storybookDir: fixture({}),
        docsDir: fixture({}),
        outDir: fixture({}),
      }),
    ).toThrow(/site build not found/);
    expect(() => assemble({ ...builds(), docsDir: fixture({}) })).toThrow(
      /docs build not found/,
    );
  });
});

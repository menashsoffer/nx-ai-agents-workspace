import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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

describe('assemble', () => {
  it('puts the site at the root and Storybook under storybook/', () => {
    const siteDir = fixture({ 'index.html': html(), '404.html': html() });
    const storybookDir = fixture({ 'index.html': html() });
    const outDir = join(mkdtempSync(join(tmpdir(), 'out-')), 'pages');

    assemble({ siteDir, storybookDir, outDir });

    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
    expect(existsSync(join(outDir, '404.html'))).toBe(true);
    expect(existsSync(join(outDir, 'storybook/index.html'))).toBe(true);
    expect(readFileSync(join(outDir, '.nojekyll'), 'utf8')).toBe('');
  });

  it('refuses a site build that already has storybook/', () => {
    const siteDir = fixture({ 'index.html': html(), 'storybook/x.txt': 'x' });
    const storybookDir = fixture({ 'index.html': html() });
    expect(() =>
      assemble({ siteDir, storybookDir, outDir: fixture({}) }),
    ).toThrow(/reserves for Storybook/);
  });

  it('rejects source maps (P2)', () => {
    const siteDir = fixture({ 'index.html': html(), 'assets/a.js.map': '{}' });
    const storybookDir = fixture({ 'index.html': html() });
    expect(() =>
      assemble({ siteDir, storybookDir, outDir: fixture({}) }),
    ).toThrow(/P2/);
  });

  it('rejects third-party scripts and styles (P1)', () => {
    const siteDir = fixture({
      'index.html': html(
        '<script src="https://cdn.example.com/x.js"></script>',
      ),
    });
    const storybookDir = fixture({
      'index.html': html(
        '<link rel="stylesheet" href="//cdn.example.com/x.css">',
      ),
    });
    expect(() =>
      assemble({ siteDir, storybookDir, outDir: fixture({}) }),
    ).toThrow(/P1[\s\S]*P1/);
  });

  it('explains a missing build', () => {
    expect(() =>
      assemble({
        siteDir: fixture({}),
        storybookDir: fixture({}),
        outDir: fixture({}),
      }),
    ).toThrow(/site build not found/);
  });
});

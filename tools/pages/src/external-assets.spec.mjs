import { describe, expect, it } from 'vitest';
import { findExternalAssets } from './external-assets.mjs';

const page = (head) => `<!doctype html><html><head>${head}</head></html>`;

describe('findExternalAssets', () => {
  it.each([
    [
      'https URL',
      '<script src="https://x.test/a.js"></script>',
      'https://x.test/a.js',
    ],
    [
      'http URL',
      '<link rel="stylesheet" href="http://x.test/a.css">',
      'http://x.test/a.css',
    ],
    [
      'spaces around =',
      '<script src = "https://x.test/a.js"></script>',
      'https://x.test/a.js',
    ],
    [
      'newline around =',
      '<link rel=stylesheet href\n=\n"https://x.test/a.css">',
      'https://x.test/a.css',
    ],
    [
      'unquoted value',
      '<script src=https://x.test/a.js></script>',
      'https://x.test/a.js',
    ],
    [
      'single quotes',
      "<script src='https://x.test/a.js'></script>",
      'https://x.test/a.js',
    ],
    [
      'protocol-relative',
      '<script src="//x.test/a.js"></script>',
      '//x.test/a.js',
    ],
    [
      'unquoted protocol-relative',
      '<script src=//x.test/a.js></script>',
      '//x.test/a.js',
    ],
    [
      'uppercase tag and attribute',
      '<SCRIPT SRC="//x.test/a.js"></SCRIPT>',
      '//x.test/a.js',
    ],
    [
      'HTML entities',
      '<script src="&#x2F;&#x2F;x.test/a.js"></script>',
      '//x.test/a.js',
    ],
    [
      'backslashes',
      '<script src="\\\\x.test/a.js"></script>',
      '\\\\x.test/a.js',
    ],
    [
      'tab inside the URL',
      '<script src="ht&#9;tps://x.test/a.js"></script>',
      'ht\ttps://x.test/a.js',
    ],
    [
      'leading whitespace',
      '<script src="  //x.test/a.js"></script>',
      '  //x.test/a.js',
    ],
    [
      'scheme without slashes',
      '<script src="https:x.test/a.js"></script>',
      'https:x.test/a.js',
    ],
    [
      'script with a src and a body',
      '<script src="//x.test/a.js">1</script>',
      '//x.test/a.js',
    ],
    [
      'inside <template>',
      '<template><script src="//x.test/a.js"></script></template>',
      '//x.test/a.js',
    ],
    [
      'inside <noscript>',
      '<noscript><link rel=stylesheet href=//x.test/a.css></noscript>',
      '//x.test/a.css',
    ],
    [
      '<base href> that re-bases every URL',
      '<base href="https://x.test/">',
      'https://x.test/',
    ],
    [
      'javascript: URL',
      '<script src="javascript:alert(1)"></script>',
      'javascript:alert(1)',
    ],
  ])('flags %s', (_name, head, url) => {
    expect(findExternalAssets(page(head))).toEqual([url]);
  });

  it('flags every asset, not just the first', () => {
    expect(
      findExternalAssets(
        page(
          '<script src=//a.test/1.js></script><link href = "http://b.test/2.css">',
        ),
      ),
    ).toEqual(['//a.test/1.js', 'http://b.test/2.css']);
  });

  it('flags a URL the parser cannot read (fail-closed)', () => {
    expect(findExternalAssets(page('<script src="http://"></script>'))).toEqual(
      ['http://'],
    );
  });

  it('passes a page with no external assets', () => {
    expect(
      findExternalAssets(
        page(`<meta charset="utf-8"><title>x</title>
          <link rel="icon" href="data:,">
          <link rel="stylesheet" href="/assets/a.css">
          <link rel="stylesheet" href = "./b.css">
          <script type="module" src=assets/c.js></script>
          <script src="../d.js"></script>
          <script>const url = 'https://x.test/inline-string-is-not-an-asset';</script>
          <base href="/repo/">`) +
          '<a href="https://x.test/">navigation, not an asset</a>',
      ),
    ).toEqual([]);
  });
});

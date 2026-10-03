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
    // Regressions: a made-up resolution base must not decide what is local.
    [
      'scheme without // (http:host/path)',
      '<script src="http:x.test/a.js"></script>',
      'http:x.test/a.js',
    ],
    [
      'uppercase scheme without //',
      '<script src="HTTP:x.test/a.js"></script>',
      'HTTP:x.test/a.js',
    ],
    [
      'control character before the scheme',
      '<script src="&#1;http:x.test/a.js"></script>',
      '\u0001http:x.test/a.js',
    ],
    [
      'the placeholder host as http://',
      '<script src="http://pages.invalid/a.js"></script>',
      'http://pages.invalid/a.js',
    ],
    [
      'the placeholder host as https://',
      '<script src="https://pages.invalid/a.js"></script>',
      'https://pages.invalid/a.js',
    ],
    [
      'the placeholder host as //',
      '<script src="//pages.invalid/a.js"></script>',
      '//pages.invalid/a.js',
    ],
    [
      'the placeholder host with backslashes',
      '<script src="\\\\pages.invalid/a.js"></script>',
      '\\\\pages.invalid/a.js',
    ],
    [
      'a scheme-like first segment',
      '<script src="foo:bar.js"></script>',
      'foo:bar.js',
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

  describe('with a known site origin', () => {
    const siteOrigin = 'https://user.github.io';
    const flagged = (head) => findExternalAssets(page(head), { siteOrigin });

    it('allows that origin and nothing else', () => {
      expect(
        flagged(
          '<script src="https://user.github.io/repo/a.js"></script><script src="//user.github.io/b.js"></script>',
        ),
      ).toEqual([]);
      expect(
        flagged('<script src="https://other.github.io/a.js"></script>'),
      ).toEqual(['https://other.github.io/a.js']);
      expect(flagged('<script src="//other.test/a.js"></script>')).toEqual([
        '//other.test/a.js',
      ]);
    });

    it('blocks the same host over another scheme and look-alike hosts', () => {
      expect(
        flagged(
          '<script src="http://user.github.io/a.js"></script><script src="http:evil.test/a.js"></script><script src="https://user.github.io.evil.test/a.js"></script>',
        ),
      ).toEqual([
        'http://user.github.io/a.js',
        'http:evil.test/a.js',
        'https://user.github.io.evil.test/a.js',
      ]);
    });

    it('still allows data: and relative URLs', () => {
      expect(
        flagged('<link rel="icon" href="data:,"><script src="a.js"></script>'),
      ).toEqual([]);
    });
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

import { describe, expect, it } from 'vitest';
import { findExternalAssets } from './external-assets.mjs';

const createHtmlPage = (head) =>
  `<!doctype html><html><head>${head}</head></html>`;

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
    [
      '@import url() in <style>',
      '<style>@import url("https://x.test/a.css");</style>',
      'https://x.test/a.css',
    ],
    [
      'bare @import in <style>',
      '<style>@import "https://x.test/b.css";</style>',
      'https://x.test/b.css',
    ],
    [
      'url() in a <style> element',
      '<style>body { background: url(https://x.test/c.png); }</style>',
      'https://x.test/c.png',
    ],
    [
      'url() in a style attribute',
      '<div style="background: url(https://x.test/d.png)"></div>',
      'https://x.test/d.png',
    ],
    [
      'a srcset candidate',
      '<img srcset="https://x.test/e.png 2x">',
      'https://x.test/e.png',
    ],
  ])('flags %s', (_name, head, url) => {
    expect(findExternalAssets(createHtmlPage(head))).toEqual([url]);
  });

  describe('with a known site origin', () => {
    const siteOrigin = 'https://user.github.io';
    const findFlaggedAssets = (head) =>
      findExternalAssets(createHtmlPage(head), { siteOrigin });

    it('allows that origin and nothing else', () => {
      expect(
        findFlaggedAssets(
          '<script src="https://user.github.io/repo/a.js"></script><script src="//user.github.io/b.js"></script>',
        ),
      ).toEqual([]);
      expect(
        findFlaggedAssets(
          '<script src="https://other.github.io/a.js"></script>',
        ),
      ).toEqual(['https://other.github.io/a.js']);
      expect(
        findFlaggedAssets('<script src="//other.test/a.js"></script>'),
      ).toEqual(['//other.test/a.js']);
    });

    it('blocks the same host over another scheme and look-alike hosts', () => {
      expect(
        findFlaggedAssets(
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
        findFlaggedAssets(
          '<link rel="icon" href="data:,"><script src="a.js"></script>',
        ),
      ).toEqual([]);
    });

    it('extends the same allow/block rule to @import, style url() and srcset', () => {
      expect(
        findFlaggedAssets(
          '<style>@import "https://user.github.io/a.css"; body{background:url(//user.github.io/b.png)}</style>',
        ),
      ).toEqual([]);
      expect(
        findFlaggedAssets(
          '<style>@import "https://other.github.io/a.css";</style>',
        ),
      ).toEqual(['https://other.github.io/a.css']);
      expect(
        findFlaggedAssets(
          '<div style="background:url(https://other.test/a.png)"></div>',
        ),
      ).toEqual(['https://other.test/a.png']);
      expect(
        findFlaggedAssets(
          '<img srcset="https://user.github.io/a.png 1x, https://other.test/b.png 2x">',
        ),
      ).toEqual(['https://other.test/b.png']);
    });
  });

  describe('CSS read as a browser reads it', () => {
    const findStyleAssets = (css) =>
      findExternalAssets(createHtmlPage(`<style>${css}</style>`));

    it.each([
      [
        'a ")" and "(" inside a double-quoted url()',
        'a{background:url("https://evil.test/a(b).png")}',
        ['https://evil.test/a(b).png'],
      ],
      [
        'a quote and parentheses inside a single-quoted url()',
        `a{background:url('https://evil.test/a"b(c).png')}`,
        ['https://evil.test/a"b(c).png'],
      ],
      [
        'an apostrophe inside a double-quoted url()',
        `a{background:url("https://evil.test/it's.png")}`,
        ["https://evil.test/it's.png"],
      ],
      [
        'an escaped quote inside a url() string',
        String.raw`a{background:url('https://evil.test/it\'s.png')}`,
        ["https://evil.test/it's.png"],
      ],
      [
        'an unquoted url() with "(" (a bad url: ignored by browsers, still flagged)',
        'a{background:url(https://evil.test/a(b).png)}',
        ['https://evil.test/a(b'],
      ],
      [
        'a CSS escape in an @import string',
        String.raw`@import "\68 ttps://evil.test/a.css";`,
        ['https://evil.test/a.css'],
      ],
      [
        'a comment between @import and its string',
        '@import/**/"https://evil.test/a.css";',
        ['https://evil.test/a.css'],
      ],
      [
        'comments and whitespace between @import and url()',
        '@import /* x */ url(https://evil.test/a.css);',
        ['https://evil.test/a.css'],
      ],
      [
        'an escaped @import keyword',
        String.raw`@\69mport "https://evil.test/b.css";`,
        ['https://evil.test/b.css'],
      ],
      [
        'an escaped url function name',
        String.raw`a{background:\75rl(https://evil.test/c.png)}`,
        ['https://evil.test/c.png'],
      ],
      [
        'escapes inside an unquoted url()',
        String.raw`a{background:url(https:\2f\2f evil.test/d.png)}`,
        ['https://evil.test/d.png'],
      ],
      [
        'a string that holds a comment opener before the url()',
        'a::before{content:"/*"} b{background:url(https://evil.test/e.png)}',
        ['https://evil.test/e.png'],
      ],
    ])('flags %s', (_name, css, expected) => {
      expect(findStyleAssets(css)).toEqual(expected);
      // The same CSS in a style attribute (quotes swapped where needed).
      if (!css.includes('{')) return;
      const body = css.slice(css.indexOf('{') + 1, css.lastIndexOf('}'));
      if (!css.startsWith('a')) return;
      const html = `<div style="${body.replace(/"/g, '&quot;')}"></div>`;
      expect(findExternalAssets(createHtmlPage(html))).toEqual(expected);
    });

    it('does not flag a url() or @import inside a CSS comment', () => {
      expect(
        findStyleAssets(
          '/* url(https://evil.test/a.png) */ @import "./ok.css"; /* @import "https://evil.test/b.css"; */ a{color:red}',
        ),
      ).toEqual([]);
      expect(
        findExternalAssets(
          createHtmlPage(
            '<div style="color:red /* url(https://evil.test/a.png) */"></div>',
          ),
        ),
      ).toEqual([]);
    });

    it('still flags a url() written after a comment', () => {
      expect(
        findStyleAssets(
          '/* ok */ a{background:url(https://evil.test/a.png)} /* end */',
        ),
      ).toEqual(['https://evil.test/a.png']);
    });

    it('does not flag a quoted url that only looks external', () => {
      expect(
        findStyleAssets('a{content:"url(https://evil.test/x.png)"}'),
      ).toEqual([]);
      expect(findStyleAssets('a{background:url("./a(b).png")}')).toEqual([]);
    });
  });

  describe('srcset read as the HTML spec reads it', () => {
    const findSrcsetAssets = (value) =>
      findExternalAssets(createHtmlPage(`<img srcset="${value}">`));

    it('does not flag a comma that is part of a same-origin URL', () => {
      expect(findSrcsetAssets('/images/a,https://evil.test/b.png 1x')).toEqual(
        [],
      );
      expect(findSrcsetAssets('a.png,https://evil.test/b.png')).toEqual([]);
    });

    it('does not flag a data: URL that contains a comma', () => {
      expect(
        findSrcsetAssets('data:image/png;base64,iVBORw0KGgo= 1x, /b.png 2x'),
      ).toEqual([]);
      expect(
        findSrcsetAssets('/b.png 1x, data:image/svg+xml,%3Csvg%2F%3E 2x'),
      ).toEqual([]);
    });

    it('still flags every external candidate', () => {
      expect(findSrcsetAssets('a.png 1x,https://evil.test/b.png 2x')).toEqual([
        'https://evil.test/b.png',
      ]);
      expect(
        findSrcsetAssets(
          'https://evil.test/a.png 1x, https://evil.test/b.png 2x',
        ),
      ).toEqual(['https://evil.test/a.png', 'https://evil.test/b.png']);
      expect(findSrcsetAssets('a.png,  https://evil.test/b.png,')).toEqual([
        'https://evil.test/b.png',
      ]);
    });

    it('treats trailing commas as the end of a candidate', () => {
      expect(
        findSrcsetAssets('a.png, https://evil.test/b.png,, c.png 2x'),
      ).toEqual(['https://evil.test/b.png']);
    });

    it('ignores a comma inside a descriptor parenthesis', () => {
      expect(
        findSrcsetAssets('a.png 2x(1,2), https://evil.test/c.png 1x'),
      ).toEqual(['https://evil.test/c.png']);
    });

    it('splits on tabs and newlines too', () => {
      expect(
        findSrcsetAssets('a.png\t1x,\nhttps://evil.test/d.png\n2x'),
      ).toEqual(['https://evil.test/d.png']);
    });
  });

  it('flags every asset, not just the first', () => {
    expect(
      findExternalAssets(
        createHtmlPage(
          '<script src=//a.test/1.js></script><link href = "http://b.test/2.css">',
        ),
      ),
    ).toEqual(['//a.test/1.js', 'http://b.test/2.css']);
  });

  it('flags a URL the parser cannot read (fail-closed)', () => {
    expect(
      findExternalAssets(createHtmlPage('<script src="http://"></script>')),
    ).toEqual(['http://']);
  });

  it('passes a page with no external assets', () => {
    expect(
      findExternalAssets(
        createHtmlPage(`<meta charset="utf-8"><title>x</title>
          <link rel="icon" href="data:,">
          <link rel="stylesheet" href="/assets/a.css">
          <link rel="stylesheet" href = "./b.css">
          <script type="module" src=assets/c.js></script>
          <script src="../d.js"></script>
          <script>const url = 'https://x.test/inline-string-is-not-an-asset';</script>
          <base href="/repo/">
          <style>@import "./c.css"; body { background: url(./d.png); }</style>
          <div style="background: url(../e.png)"></div>
          <img srcset="f.png 1x, ./g.png 2x">`) +
          '<a href="https://x.test/">navigation, not an asset</a>',
      ),
    ).toEqual([]);
  });
});

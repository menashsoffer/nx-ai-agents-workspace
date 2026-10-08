import { describe, expect, it } from 'vitest';
import { findExternalAssets } from './external-assets.mjs';
import { HTML_LOADING_CASES } from './external-assets.html-loading.cases.mjs';
import { CSS_PARSING_CASES } from './external-assets.css-parsing.cases.mjs';

const createHtmlPage = (head) =>
  `<!doctype html><html><head>${head}</head></html>`;

describe('findExternalAssets', () => {
  it.each(HTML_LOADING_CASES)('flags %s', (_name, head, url) => {
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

    it.each(CSS_PARSING_CASES)('flags %s', (_name, css, expected) => {
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

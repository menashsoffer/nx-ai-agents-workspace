export const HTML_LOADING_CASES = [
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
  ['backslashes', '<script src="\\\\x.test/a.js"></script>', '\\\\x.test/a.js'],
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
];

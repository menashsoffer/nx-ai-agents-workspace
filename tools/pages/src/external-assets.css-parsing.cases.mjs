export const CSS_PARSING_CASES = [
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
];

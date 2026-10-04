export const CSS_CASES: Array<[string, string, number]> = [
  ['flags a root-absolute url()', '.a { background: url(/bg.png); }', 1],
  ['flags a quoted url()', ".a { background: url('/bg.png'); }", 1],
  [
    'flags url( with upper case and spaces',
    '.a { background: URL(  "/bg.png"  ); }',
    1,
  ],
  [
    'flags an escaped url function name',
    String.raw`.a { background: \75rl(/bg.png); }`,
    1,
  ],
  [
    'flags an escaped url function name, split',
    String.raw`.a { background: u\72l(/bg.png); }`,
    1,
  ],
  [
    'flags an escape inside the URL',
    String.raw`.a { background: url("\2f bg.png"); }`,
    1,
  ],
  ['flags a root-absolute @import string', '@import "/other.css";', 1],
  [
    'flags a root-absolute @import with a comment',
    '@import/**/"/other.css";',
    1,
  ],
  [
    'flags an unquoted url() with a parenthesis (a bad url)',
    '.a { background: url(/a(b).png); }',
    1,
  ],
  [
    'flags every violating url()',
    '.a { background: url(/a.png), url(/b.png); }',
    2,
  ],
  [
    'flags a space inside a quoted url()',
    '.a { background: url(" /bg.png"); }',
    1,
  ],
  [
    'flags a space inside a single-quoted url()',
    ".a { background: url(' /bg.png'); }",
    1,
  ],
  [
    'flags several spaces inside a quoted url()',
    '.a { background: url("    /bg.png"); }',
    1,
  ],
  [
    'flags a literal tab inside a quoted url()',
    '.a { background: url("\t/bg.png"); }',
    1,
  ],
  [
    'flags a tab and a space inside a quoted url()',
    '.a { background: url("\t /bg.png"); }',
    1,
  ],
  [
    'flags a leading space in a quoted url( with outer spaces',
    '.a { background: URL(  " /bg.png"  ); }',
    1,
  ],
  ['flags a leading space in an @import string', '@import " /x.css";', 1],
  ['flags a leading space in an @import url()', '@import url(" /x.css");', 1],
  [
    'flags a tab written as a CSS escape (\\9 )',
    String.raw`.a { background: url("\9 /bg.png"); }`,
    1,
  ],
  [
    'flags a space written as a CSS escape (\\20 )',
    String.raw`.a { background: url("\20 /bg.png"); }`,
    1,
  ],
  [
    'flags a newline written as a CSS escape (\\A )',
    String.raw`.a { background: url("\A /bg.png"); }`,
    1,
  ],
  [
    'flags a control character written as a CSS escape (\\1 )',
    String.raw`.a { background: url("\1 /bg.png"); }`,
    1,
  ],
  [
    'flags an escape before the quote content in an @import',
    String.raw`@import "\9 /x.css";`,
    1,
  ],
  [
    'passes a no-break space before "/", which a URL parser keeps',
    '.a { background: url("\u00A0/bg.png"); }',
    0,
  ],
  [
    'passes a no-break space written as a CSS escape (\\A0 )',
    String.raw`.a { background: url("\A0 /bg.png"); }`,
    0,
  ],
  [
    'passes a leading space before a relative path',
    '.a { background: url(" ./bg.png"); } .b { background: url(" bg.png"); }',
    0,
  ],
  [
    'passes a quoted url that has trailing space only',
    '.a { background: url("bg.png "); }',
    0,
  ],
  [
    'passes a leading space in a url() inside a comment',
    '/* url(" /bg.png") and @import " /x.css"; */ .a { color: red; }',
    0,
  ],
  [
    'passes a raw newline inside a quoted url() (a bad string that browsers ignore)',
    '.a { background: url("\n/bg.png"); }',
    0,
  ],
  ['passes a relative url()', '.a { background: url(./bg.png); }', 0],
  ['passes a url() through a package', '@import "@starter/ui/styles.css";', 0],
  [
    'passes a url() inside a comment',
    '/* url(/bg.png) */ .a { color: red; }',
    0,
  ],
  [
    'passes an @import inside a comment',
    '/* @import "/x.css"; */ .a { color: red; }',
    0,
  ],
  [
    'passes a url( text inside a string',
    '.a::before { content: "url(/bg.png)"; }',
    0,
  ],
  [
    'passes a comment opener inside a string before a relative url()',
    '.a::before { content: "/*"; } .b { background: url(./bg.png); }',
    0,
  ],
];

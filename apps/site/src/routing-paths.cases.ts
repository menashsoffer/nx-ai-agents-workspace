export const FIXTURE_CASES: Array<[string, string, number]> = [
  [
    'flags a hard-coded root-absolute <a> href string literal',
    '<a href="/about">about</a>',
    1,
  ],
  [
    'flags an <a> href template literal that does not start with BASE_URL',
    '<a href={`/about`}>about</a>',
    1,
  ],
  [
    'passes an <a> href template literal built from BASE_URL',
    '<a href={`${import.meta.env.BASE_URL}code-map/`}>map</a>',
    0,
  ],
  [
    'passes internal navigation expressed with Link/NavLink',
    '<Link to="/about">about</Link><NavLink to="/">home</NavLink>',
    0,
  ],
  [
    'flags a hard-coded root-absolute img src string literal',
    '<img src="/logo.svg" alt="" />',
    1,
  ],
  [
    'flags a hard-coded root-absolute link href string literal',
    '<link href="/favicon.svg" rel="icon" />',
    1,
  ],
  [
    'passes an img src template literal built from BASE_URL',
    '<img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />',
    0,
  ],
  [
    'passes an asset reference through an import',
    'import logo from \'./logo.svg\';\n<img src={logo} alt="" />',
    0,
  ],
  [
    'flags a CSS url() that hard-codes a root-absolute path',
    "const backgroundImage = 'url(/bg.png)';",
    1,
  ],
  [
    'passes a CSS url() built from BASE_URL',
    'const backgroundImage = `url(${import.meta.env.BASE_URL}bg.png)`;',
    0,
  ],
];

// What a regular expression over the text got wrong: every case below is a
// real violation, or a real non-violation, that the AST reading handles.
export const SYNTAX_CASES: Array<[string, string, number]> = [
  ['flags spaces around =', '<a href = "/x">x</a>', 1],
  ['flags a newline around =', '<a\n  href\n  =\n  "/x"\n>x</a>', 1],
  ['flags a comment inside the braces', '<a href={/* x */ "/x"}>x</a>', 1],
  [
    'flags a ">" inside an earlier quoted attribute',
    '<a title="a > b" href="/x">x</a>',
    1,
  ],
  [
    'flags the first of several src/href attributes on one tag',
    '<link src="/first.js" href={`${import.meta.env.BASE_URL}ok.css`} rel="x" />',
    1,
  ],
  [
    'flags every violating attribute on one tag',
    '<link src="/a.js" href="/b.css" />',
    2,
  ],
  [
    'flags a root-absolute branch of a conditional',
    '<a href={isLocal ? "/x" : undefined}>x</a>',
    1,
  ],
  ['flags a root-absolute fallback', '<a href={custom ?? "/x"}>x</a>', 1],
  [
    'flags a root-absolute string concatenation',
    '<a href={"/x" + slug}>x</a>',
    1,
  ],
  ['flags a src on any element', '<script src="/main.js"></script>', 1],
  [
    'flags a CSS url() with a quoted, spaced, upper-case URL(',
    'const style = { backgroundImage: \'URL( "/bg.png" )\' };',
    1,
  ],
  [
    'flags a CSS url() hidden behind escapes',
    String.raw`const style = 'u\\72l(/bg.png)';`,
    1,
  ],
  [
    'flags a CSS url() in a template literal',
    'const style = `url(/${name}.png)`;',
    1,
  ],
  [
    'passes a relative href and src',
    '<a href="about">x</a><img src="logo.svg" alt="" />',
    0,
  ],
  [
    'passes an href on an element that does not navigate',
    '<use href="/sprite.svg#icon" />',
    0,
  ],
  [
    'passes a base-path template with spaces inside the placeholder',
    '<a href={`${ import.meta.env.BASE_URL }x`}>x</a>',
    0,
  ],
  [
    'passes an example in a JSX comment',
    '<p>{/* <a href="/x">example</a> */}</p>',
    0,
  ],
  [
    'passes an example in a line comment',
    '// <a href="/x">example</a>\nconst value = 1;',
    0,
  ],
  [
    'passes an example in a block comment',
    '/* <img src="/x.png" alt="" /> and url(/bg.png) */\nconst value = 1;',
    0,
  ],
  [
    'passes a CSS url() that only appears in a comment',
    '/** background: url(/bg.png) */\nconst value = 1;',
    0,
  ],
  [
    'flags a decimal character reference for "/" in a JSX attribute',
    '<a href="&#47;x">x</a>',
    1,
  ],
  [
    'flags a hexadecimal character reference for "/"',
    '<a href="&#x2f;x">x</a>',
    1,
  ],
  [
    'flags a hexadecimal reference with capital digits',
    '<a href="&#x2F;x">x</a>',
    1,
  ],
  [
    'flags a character reference with leading zeros',
    '<a href="&#00047;x">x</a>',
    1,
  ],
  [
    'flags two character references for "//"',
    '<script src="&#x2F;&#47;cdn.test/a.js"></script>',
    1,
  ],
  [
    'flags a character reference in a single-quoted attribute',
    '<img src=\'&#47;logo.svg\' alt="" />',
    1,
  ],
  [
    'passes a named reference the JSX transform decodes to another character',
    '<a href="&amp;x">x</a><a href="&nbsp;/x">x</a>',
    0,
  ],
  [
    'passes a named reference the JSX transform leaves as written',
    '<a href="&sol;x">x</a>',
    0,
  ],
  [
    'passes an unterminated or unknown reference',
    '<a href="&#47x">x</a><a href="&unknown;/x">x</a>',
    0,
  ],
  [
    'passes an uppercase hexadecimal marker, which the transform does not decode',
    '<a href="&#X2F;x">x</a>',
    0,
  ],
  [
    'does not decode references in a JS string inside braces',
    '<a href={"&#47;x"}>x</a>',
    0,
  ],
  [
    'does not decode references in an ordinary string',
    "const text = '&#47;x'; const style = 'url(&#47;bg.png)';",
    0,
  ],
  [
    'flags an empty-string prefix on a root-absolute string',
    '<a href={"" + "/x"}>x</a>',
    1,
  ],
  ['flags several empty-string prefixes', '<a href={"" + "" + "/x"}>x</a>', 1],
  [
    'flags a root-absolute string built from two literals',
    '<a href={"/" + "x"}>x</a>',
    1,
  ],
  [
    'flags a parenthesised literal concatenation',
    '<a href={("" + "/x")}>x</a>',
    1,
  ],
  [
    'flags a literal prefix followed by an unknown value',
    '<a href={"" + "/" + slug}>x</a>',
    1,
  ],
  [
    'flags a literal concatenation in an img src',
    '<img src={"" + "/logo.svg"} alt="" />',
    1,
  ],
  [
    'passes a BASE_URL prefix before a root-absolute string',
    '<a href={import.meta.env.BASE_URL + "/x"}>x</a>',
    0,
  ],
  [
    'passes an empty prefix before BASE_URL',
    '<a href={"" + import.meta.env.BASE_URL + "/x"}>x</a>',
    0,
  ],
  [
    'passes an unknown value before a root-absolute string',
    '<a href={slug + "/x"}>x</a>',
    0,
  ],
  [
    'passes an empty prefix before an unknown value',
    '<a href={"" + slug}>x</a>',
    0,
  ],
  [
    'passes a relative literal concatenation',
    '<a href={"api" + "/x"}>x</a>',
    0,
  ],
  [
    'flags a leading space before "/" in a JSX attribute',
    '<a href=" /x">x</a>',
    1,
  ],
  ['flags several leading spaces', '<a href="    /x">x</a>', 1],
  ['flags a literal leading tab', '<a href="\t/x">x</a>', 1],
  ['flags a literal leading newline', '<a href="\n/x">x</a>', 1],
  ['flags a leading C0 control character', '<a href="\u0001/x">x</a>', 1],
  [
    'flags a leading space written as a character reference',
    '<a href="&#32;/x">x</a>',
    1,
  ],
  [
    'flags a leading tab written as a character reference',
    '<a href="&#9;/x">x</a>',
    1,
  ],
  ['flags a leading space in a src', '<img src=" /logo.svg" alt="" />', 1],
  [
    'flags a leading space in a JS string inside braces',
    '<a href={" /x"}>x</a>',
    1,
  ],
  [
    'flags a leading tab in a JS string inside braces',
    '<a href={"\t/x"}>x</a>',
    1,
  ],
  [
    'flags a leading space in a literal concatenation',
    '<a href={" " + "/x"}>x</a>',
    1,
  ],
  [
    'flags leading whitespace before an empty-string prefix',
    '<a href={" " + "" + "/x"}>x</a>',
    1,
  ],
  [
    'passes whitespace that is not leading',
    '<a href="x /y">x</a><a href="x/ ">x</a><a href=" x">x</a>',
    0,
  ],
  [
    'passes trailing whitespace after a relative path',
    '<a href={"about "}>x</a>',
    0,
  ],
  [
    'passes a leading space before an unknown value',
    '<a href={" " + slug}>x</a>',
    0,
  ],
  [
    'passes a leading space before BASE_URL',
    '<a href={" " + import.meta.env.BASE_URL + "/x"}>x</a>',
    0,
  ],
  [
    'passes a space after the BASE_URL prefix',
    '<a href={import.meta.env.BASE_URL + " /x"}>x</a>',
    0,
  ],
  [
    'flags a quoted CSS url() with a leading space in a string',
    'const style = { backgroundImage: \'url(" /bg.png")\' };',
    1,
  ],
  [
    'flags a quoted CSS url() with a leading tab in a string',
    'const style = { backgroundImage: \'url("\\t/bg.png")\' };',
    1,
  ],
  [
    'flags a quoted CSS url() with a leading space in a template literal',
    'const style = `url(" /${name}.png")`;',
    1,
  ],
  [
    'flags a CSS escape for a tab in a string',
    String.raw`const style = 'url("\\9 /bg.png")';`,
    1,
  ],
  [
    'flags a leading space in an @import written in a string',
    'const css = \'@import " /x.css";\';',
    1,
  ],
  [
    'passes a quoted CSS url() with a no-break space in a string',
    'const style = { backgroundImage: \'url("\u00A0/bg.png")\' };',
    0,
  ],
  [
    'passes a quoted CSS url() with a space before BASE_URL',
    'const style = `url(" ${import.meta.env.BASE_URL}bg.png")`;',
    0,
  ],
  [
    'passes a quoted CSS url() with a space in a comment',
    '// url(" /bg.png")\nconst value = 1;',
    0,
  ],
  [
    'passes a string that merely contains the word url',
    "const text = 'see the url (/docs)';",
    0,
  ],
];

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

// Each case is written to a real file in the real source tree and found by the
// same tree walk that guards the app, so file selection (extensions, folders)
// is under test too, not just the scanner. The files are removed afterwards.
export const PLANTED_CASES: Array<[string, string, string, number]> = [
  [
    'a .tsx with spaces around =',
    'Planted.tsx',
    'export const Planted = () => <a href = "/x">x</a>;',
    1,
  ],
  [
    'a .tsx with a comment inside the braces',
    'Planted.tsx',
    'export const Planted = () => <a href={/* x */ "/x"}>x</a>;',
    1,
  ],
  [
    'a .tsx with ">" in an earlier attribute',
    'Planted.tsx',
    'export const Planted = () => <a title="a > b" href="/x">x</a>;',
    1,
  ],
  [
    'a .tsx tag with several src/href attributes',
    'Planted.tsx',
    'export const Planted = () => <link src="/a.js" href="/b.css" />;',
    2,
  ],
  [
    'a .ts file with a CSS url() string',
    'planted.ts',
    "export const background = 'url(/bg.png)';",
    1,
  ],
  [
    'a real .css file with url()',
    'planted.css',
    '.a { background: url(/bg.png); }',
    1,
  ],
  [
    'a real .css file with URL( and an escape',
    'planted.css',
    String.raw`.a { background: URL( "/a.png" ); } .b { background: \75rl(/b.png); }`,
    2,
  ],
  ['a real .css file with @import', 'planted.css', '@import "/other.css";', 1],
  [
    'a .tsx with a character reference for "/"',
    'Planted.tsx',
    'export const Planted = () => <a href="&#47;x">x</a>;',
    1,
  ],
  [
    'a .tsx with a hexadecimal character reference for "//"',
    'Planted.tsx',
    'export const Planted = () => <script src="&#x2F;&#x2f;cdn.test/a.js"></script>;',
    1,
  ],
  [
    'a .tsx with an empty-string prefix on a root-absolute string',
    'Planted.tsx',
    'export const Planted = () => <a href={"" + "/x"}>x</a>;',
    1,
  ],
  [
    'a .tsx with a literal prefix followed by an unknown value',
    'Planted.tsx',
    'export const Planted = ({ slug }: { slug: string }) => <a href={"" + "/" + slug}>x</a>;',
    1,
  ],
  [
    'a .tsx whose "&#47;" is inside a JS string, not a JSX attribute',
    'Planted.tsx',
    'export const Planted = () => <a href={"&#47;x"}>x</a>;',
    0,
  ],
  [
    'a .tsx that puts BASE_URL before a root-absolute string',
    'Planted.tsx',
    'export const Planted = () => <a href={import.meta.env.BASE_URL + "/x"}>x</a>;',
    0,
  ],
  [
    'a .tsx with a leading space',
    'Planted.tsx',
    'export const Planted = () => <a href=" /x">x</a>;',
    1,
  ],
  [
    'a .tsx with a leading tab and newline',
    'Planted.tsx',
    'export const Planted = () => <a href="\t\n/x">x</a>;',
    1,
  ],
  [
    'a .tsx with a leading space as a character reference',
    'Planted.tsx',
    'export const Planted = () => <a href="&#32;/x">x</a>;',
    1,
  ],
  [
    'a .tsx with a leading tab as a character reference',
    'Planted.tsx',
    'export const Planted = () => <a href="&#9;/x">x</a>;',
    1,
  ],
  [
    'a .tsx with a leading space in a JS string inside braces',
    'Planted.tsx',
    'export const Planted = () => <a href={" /x"}>x</a>;',
    1,
  ],
  [
    'a .tsx with a leading space in a literal concatenation',
    'Planted.tsx',
    'export const Planted = () => <a href={" " + "/x"}>x</a>;',
    1,
  ],
  [
    'a .tsx with a space after the BASE_URL prefix',
    'Planted.tsx',
    'export const Planted = () => <a href={import.meta.env.BASE_URL + " /x"}>x</a>;',
    0,
  ],
  [
    'a real .css file with a space inside a quoted url()',
    'planted.css',
    '.a { background: url(" /bg.png"); }',
    1,
  ],
  [
    'a real .css file with a tab inside a quoted url()',
    'planted.css',
    '.a { background: url("\t/bg.png"); }',
    1,
  ],
  [
    'a real .css file with a leading space in an @import',
    'planted.css',
    '@import " /x.css";',
    1,
  ],
  [
    'a real .css file with the tab as a CSS escape',
    'planted.css',
    String.raw`.a { background: url("\9 /bg.png"); }`,
    1,
  ],
  [
    'a .tsx with a quoted CSS url() with a leading space in a string',
    'Planted.tsx',
    'export const style = { backgroundImage: \'url(" /bg.png")\' };',
    1,
  ],
  [
    'a real .css file with a no-break space before "/"',
    'planted.css',
    '.a { background: url("\u00A0/bg.png"); }',
    0,
  ],
  [
    'a real .css file with a leading space inside a comment',
    'planted.css',
    '/* url(" /bg.png") */ .a { color: red; }',
    0,
  ],
  [
    'a .ts with a space before BASE_URL in a CSS string',
    'planted.ts',
    'export const style = `url(" ${import.meta.env.BASE_URL}bg.png")`;',
    0,
  ],
  [
    'a .tsx whose only path is in a JSX comment',
    'Planted.tsx',
    'export const Planted = () => <p>{/* <a href="/x">example</a> */}</p>;',
    0,
  ],
  [
    'a .ts whose only path is in a comment',
    'planted.ts',
    '// <img src="/x.png" /> and url(/bg.png)\nexport const value = 1;',
    0,
  ],
  [
    'a real .css file whose only url() is in a comment',
    'planted.css',
    '/* url(/bg.png) and @import "/x.css" */ .a { color: red; }',
    0,
  ],
  [
    'a .tsx that uses the base path and Link',
    'Planted.tsx',
    'export const Planted = () => <><a href={`${import.meta.env.BASE_URL}x`}>x</a><Link to="/x">x</Link></>;',
    0,
  ],
];

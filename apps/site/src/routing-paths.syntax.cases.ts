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

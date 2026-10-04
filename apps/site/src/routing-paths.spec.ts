import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

// Internal navigation and public assets must go through the Pages base path
// (see AGENTS.md "Routing and deployment"): either react-router's Link/NavLink
// (basename-aware) or a value built from import.meta.env.BASE_URL. A raw
// href/src that hard-codes a leading "/" breaks on GitHub Pages, where the site is served from
// (/<repo>/, or /<repo>/pr-<n>/ for previews).
//
// The scanner reads the source the way the compiler does (TypeScript's parser
// for .ts/.tsx, the CSS tokenizer of the Pages check for CSS), so spacing,
// comments, other attributes on the tag and quoting cannot hide a violation,
// and an example inside a comment cannot cause one.
const BASE_URL_EXPRESSION = 'import.meta.env.BASE_URL';
const BASE_URL_TEMPLATE_START = '${import.meta.env.BASE_URL}';

interface CssToken {
  type: string;
  value: string;
}

// tools/pages is tooling, which an app may not depend on (module boundaries),
// so its tokenizer is loaded through a computed specifier, the way
// libs/shared/utils/src/lib/conventions-audit.spec.ts loads eslint.config.mjs.
const workspaceRoot = resolve(import.meta.dirname, '../../..');
const cssTokensUrl = pathToFileURL(
  resolve(workspaceRoot, 'tools/pages/src/css-tokens.mjs'),
).href;
const { tokenizeCss } = (await import(cssTokensUrl)) as {
  tokenizeCss: (cssText: string) => CssToken[];
};

/** Elements whose `href` loads or links something; `src` is checked on any element. */
const HREF_ELEMENT_NAMES = new Set(['a', 'link', 'img']);

/** Stands in for `${...}` when a template literal is read as CSS text. */
const TEMPLATE_PLACEHOLDER = '\0';

/** The URLs a CSS text references (`url()` and `@import`) that start with "/". */
function findRootAbsoluteCssUrls(cssText: string): string[] {
  const tokens = tokenizeCss(cssText);
  const urls: string[] = [];
  tokens.forEach((token, index) => {
    const nextToken = tokens[index + 1];
    if (token.type === 'url' || token.type === 'bad-url') {
      urls.push(token.value);
    } else if (
      nextToken?.type === 'string' &&
      ((token.type === 'function' && token.value === 'url') ||
        (token.type === 'at-keyword' && token.value === 'import'))
    ) {
      urls.push(nextToken.value);
    }
  });
  return urls.filter((url) => url.startsWith('/'));
}

const withoutWhitespace = (text: string) => text.replace(/\s+/g, '');

function findFirstNode<TNode extends ts.Node>(
  root: ts.Node,
  isMatch: (node: ts.Node) => node is TNode,
): TNode | undefined {
  if (isMatch(root)) return root;
  return ts.forEachChild(root, (child) => findFirstNode(child, isMatch));
}

/**
 * The value of a quoted JSX attribute (`"..."` or `'...'`, quotes included)
 * after the JSX transform: numeric character references (`&#47;`, `&#x2f;`) and
 * the named ones the transform knows (`&amp;`, `&nbsp;`) are decoded, the rest
 * (`&sol;`, `&unknown;`) stay as written. TypeScript itself decides, by
 * compiling a one-attribute element and reading the string it emits, so the
 * scanner agrees with the compiled code. Only JSX attribute strings are
 * decoded; a JS string in braces (`href={"&#47;x"}`) is not.
 */
function decodeJsxAttributeText(quotedAttributeValue: string): string {
  const rawText = quotedAttributeValue.slice(1, -1);
  if (!rawText.includes('&')) return rawText;
  const emittedCode = ts.transpileModule(`<a a=${quotedAttributeValue} />;`, {
    fileName: 'attribute.tsx',
    compilerOptions: { jsx: ts.JsxEmit.React },
  }).outputText;
  const emittedProperty = findFirstNode(
    ts.createSourceFile(
      'emitted.js',
      emittedCode,
      ts.ScriptTarget.Latest,
      true,
    ),
    (node): node is ts.PropertyAssignment =>
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'a',
  );
  return emittedProperty && ts.isStringLiteral(emittedProperty.initializer)
    ? emittedProperty.initializer.text
    : rawText;
}

/**
 * The text an expression starts with, as far as the source fixes it, and
 * whether that is all of it. `"" + "/x"` is "/x" in full; `"" + slug` is "" and
 * incomplete (unknown after that); `import.meta.env.BASE_URL + "/x"` starts
 * with something unknown, so nothing about its start is known.
 */
function readStaticPrefix(expression: ts.Expression): {
  text: string;
  isComplete: boolean;
} {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return readStaticPrefix(expression.expression);
  }
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return { text: expression.text, isComplete: true };
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = readStaticPrefix(expression.left);
    if (!left.isComplete) return left;
    const right = readStaticPrefix(expression.right);
    return { text: left.text + right.text, isComplete: right.isComplete };
  }
  return { text: '', isComplete: false };
}

/**
 * Why an attribute expression breaks the base path, or undefined if it does
 * not. Only the parts that can be read from the source count: a string that
 * starts with "/", or a template literal that does not start with BASE_URL.
 */
function describeUrlViolation(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return describeUrlViolation(expression.expression, sourceFile);
  }
  if (ts.isStringLiteral(expression)) {
    return expression.text.startsWith('/')
      ? 'must not hard-code a root-absolute path'
      : undefined;
  }
  const templateMessage = `template literal must start with ${BASE_URL_TEMPLATE_START}`;
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return templateMessage;
  if (ts.isTemplateExpression(expression)) {
    const firstSpan = expression.templateSpans[0];
    const startsWithBaseUrl =
      expression.head.text === '' &&
      withoutWhitespace(firstSpan.expression.getText(sourceFile)) ===
        BASE_URL_EXPRESSION;
    return startsWithBaseUrl ? undefined : templateMessage;
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      describeUrlViolation(expression.whenTrue, sourceFile) ??
      describeUrlViolation(expression.whenFalse, sourceFile)
    );
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.PlusToken) {
      // A prefix the source fixes decides first: `"" + "/x"` is "/x".
      return readStaticPrefix(expression).text.startsWith('/')
        ? 'must not hard-code a root-absolute path'
        : describeUrlViolation(expression.left, sourceFile);
    }
    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return (
        describeUrlViolation(expression.left, sourceFile) ??
        describeUrlViolation(expression.right, sourceFile)
      );
    }
  }
  return undefined;
}

/** The text of a string or template literal, read as CSS (expressions are gaps). */
function readLiteralAsCssText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce(
      (text, span) => text + TEMPLATE_PLACEHOLDER + span.literal.text,
      node.head.text,
    );
  }
  return undefined;
}

function findRoutingPathViolations(
  filePath: string,
  content: string,
): string[] {
  if (filePath.endsWith('.css')) {
    return findRootAbsoluteCssUrls(content).map(
      (url) =>
        `${filePath}: url() must not hard-code a root-absolute path (${url})`,
    );
  }

  const violations: string[] = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const report = (node: ts.Node, message: string) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    violations.push(`${filePath}:${line + 1}: ${message}`);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const elementName = node.tagName.getText(sourceFile);
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) {
          continue;
        }
        const attributeName = attribute.name.text;
        const isChecked =
          attributeName === 'src' ||
          (attributeName === 'href' && HREF_ELEMENT_NAMES.has(elementName));
        if (!isChecked || !attribute.initializer) continue;
        const { initializer } = attribute;
        const expression = ts.isJsxExpression(initializer)
          ? initializer.expression
          : initializer;
        const message = ts.isStringLiteral(initializer)
          ? decodeJsxAttributeText(initializer.getText(sourceFile)).startsWith(
              '/',
            )
            ? 'must not hard-code a root-absolute path'
            : undefined
          : expression && describeUrlViolation(expression, sourceFile);
        if (message) {
          report(attribute, `<${elementName}> ${attributeName} ${message}`);
        }
      }
    }
    const cssText = readLiteralAsCssText(node);
    if (cssText !== undefined && findRootAbsoluteCssUrls(cssText).length > 0) {
      report(node, 'url() must not hard-code a root-absolute path');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

const SCANNED_FILE = /\.(tsx?|css)$/;
const TEST_FILE = /\.(spec|test)\.tsx?$/;

function collectSourceFiles(directoryPath: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (SCANNED_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function findTreeViolations(directoryPath: string): string[] {
  return collectSourceFiles(directoryPath).flatMap((filePath) =>
    findRoutingPathViolations(filePath, readFileSync(filePath, 'utf8')),
  );
}

const FIXTURE_CASES: Array<[string, string, number]> = [
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

describe('findRoutingPathViolations', () => {
  it.each(FIXTURE_CASES)('%s', (_description, content, violationCount) => {
    expect(findRoutingPathViolations('fixture.tsx', content)).toHaveLength(
      violationCount,
    );
  });
});

// What a regular expression over the text got wrong: every case below is a
// real violation, or a real non-violation, that the AST reading handles.
const SYNTAX_CASES: Array<[string, string, number]> = [
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
    'passes a string that merely contains the word url',
    "const text = 'see the url (/docs)';",
    0,
  ],
];

describe('findRoutingPathViolations: syntax the scanner must read', () => {
  it.each(SYNTAX_CASES)('%s', (_description, content, violationCount) => {
    expect(findRoutingPathViolations('fixture.tsx', content)).toHaveLength(
      violationCount,
    );
  });
});

const CSS_CASES: Array<[string, string, number]> = [
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

describe('findRoutingPathViolations: CSS files', () => {
  it.each(CSS_CASES)('%s', (_description, content, violationCount) => {
    expect(findRoutingPathViolations('fixture.css', content)).toHaveLength(
      violationCount,
    );
  });
});

// Each case is written to a real file in the real source tree and found by the
// same tree walk that guards the app, so file selection (extensions, folders)
// is under test too, not just the scanner. The files are removed afterwards.
const PLANTED_CASES: Array<[string, string, string, number]> = [
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

describe('a file planted in the real source tree', () => {
  let plantedDirectory: string | undefined;

  afterEach(() => {
    if (plantedDirectory)
      rmSync(plantedDirectory, { recursive: true, force: true });
    plantedDirectory = undefined;
  });

  it.each(PLANTED_CASES)(
    '%s',
    (_description, fileName, content, violationCount) => {
      plantedDirectory = mkdtempSync(join(import.meta.dirname, 'planted-'));
      writeFileSync(join(plantedDirectory, fileName), content);

      const plantedViolations = findTreeViolations(import.meta.dirname).filter(
        (violation) => violation.includes(plantedDirectory as string),
      );

      expect(plantedViolations).toHaveLength(violationCount);
    },
  );
});

describe('apps/site/src', () => {
  it('has no routing-path violations', () => {
    expect(findTreeViolations(import.meta.dirname)).toEqual([]);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

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

/**
 * The URLs a CSS text references (`url()` and `@import`) that are root-absolute.
 * The tokenizer keeps whitespace inside a quoted string, so the same leading
 * C0 controls and spaces that a URL parser strips are ignored here too.
 */
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
  return urls.filter(isRootAbsolutePath);
}

const withoutWhitespace = (text: string) => text.replace(/\s+/g, '');

/**
 * True if a URL's text is a root-absolute path. A URL parser drops leading C0
 * control characters and spaces (U+0000 to U+0020) first, so " /x", "\t/x" and
 * "\n/x" are "/x". Trailing characters are not touched.
 */
function isRootAbsolutePath(urlText: string): boolean {
  let start = 0;
  while (start < urlText.length && urlText.charCodeAt(start) <= 0x20) start++;
  return urlText.startsWith('/', start);
}

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
    return isRootAbsolutePath(expression.text)
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
      return isRootAbsolutePath(readStaticPrefix(expression).text)
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

export function findRoutingPathViolations(
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
          ? isRootAbsolutePath(
              decodeJsxAttributeText(initializer.getText(sourceFile)),
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
// Test files, and the two modules that hold the scanner and its cases for them
// (the cases hold root-absolute paths on purpose), are not application source.
const TEST_FILE = /\.(spec|test)\.tsx?$|^routing-paths\.(scanner|cases)\.ts$/;

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

export function findTreeViolations(directoryPath: string): string[] {
  return collectSourceFiles(directoryPath).flatMap((filePath) =>
    findRoutingPathViolations(filePath, readFileSync(filePath, 'utf8')),
  );
}

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

// Finds the fixture categories a convention-audit spec runs, so that
// docs/conventions.md can be checked against them. It reads the syntax tree:
// quote style, helper functions and tables written inline do not matter.

export type SourceReader = (path: string) => string;

const readFromDisk: SourceReader = (path) => readFileSync(path, 'utf8');

const parse = (path: string, read: SourceReader) =>
  ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);

/** Every `category` value under `node`; one that is not a literal is named as such. */
function collectCategories(node: ts.Node): string[] {
  const isCategory =
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    node.name.getText() === 'category';
  const own = isCategory
    ? [
        ts.isPropertyAssignment(node) &&
        ts.isStringLiteralLike(node.initializer)
          ? node.initializer.text
          : `<non-literal ${node.getText()}>`,
      ]
    : [];
  const inner: string[] = [];
  ts.forEachChild(
    node,
    (child) => void inner.push(...collectCategories(child)),
  );
  return [...own, ...inner];
}

function findImportedPath(
  sourceFile: ts.SourceFile,
  name: string,
): string | undefined {
  for (const statement of sourceFile.statements) {
    const bindings =
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith('./') &&
      bindings.elements.some((element) => element.name.text === name)
    ) {
      return resolve(
        dirname(sourceFile.fileName),
        statement.moduleSpecifier.text.replace(/\.js$/, '.ts'),
      );
    }
  }
  return undefined;
}

/** The categories of one table: written in place, declared in the spec, or imported. */
function collectTableCategories(
  table: ts.Node,
  specFile: ts.SourceFile,
  read: SourceReader,
): string[] {
  const categories = collectCategories(table);
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const importedPath = findImportedPath(specFile, node.text);
      const declaration = specFile.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => [...statement.declarationList.declarations])
        .find(({ name }) => name.getText() === node.text);
      if (importedPath) {
        categories.push(...collectCategories(parse(importedPath, read)));
      } else if (declaration?.initializer) {
        categories.push(...collectCategories(declaration.initializer));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(table);
  return categories;
}

/** The categories of every `it.each` table inside `describe(describeTitle, ...)`. */
export function collectConsumedCategories(
  specPath: string,
  describeTitle: string,
  read: SourceReader = readFromDisk,
): string[] {
  const specFile = parse(specPath, read);
  const describeCall = specFile.statements
    .filter(ts.isExpressionStatement)
    .map(({ expression }) => expression)
    .filter(ts.isCallExpression)
    .find(
      (call) =>
        call.expression.getText() === 'describe' &&
        ts.isStringLiteralLike(call.arguments[0]) &&
        call.arguments[0].text === describeTitle,
    );
  if (!describeCall) {
    throw new Error(
      `${specPath} has no top-level describe('${describeTitle}')`,
    );
  }
  const categories: string[] = [];
  let tableCount = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === 'it.each') {
      tableCount++;
      categories.push(
        ...collectTableCategories(node.arguments[0], specFile, read),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(describeCall);
  if (tableCount === 0) {
    throw new Error(
      `describe('${describeTitle}') in ${specPath} has no it.each table`,
    );
  }
  return [...new Set(categories)];
}

/** Every category in a spec and in the `*.cases` files it imports, used or not. */
export function collectSpecCategories(
  specPath: string,
  read: SourceReader = readFromDisk,
): string[] {
  const specFile = parse(specPath, read);
  const casesPaths = specFile.statements
    .filter(ts.isImportDeclaration)
    .map(({ moduleSpecifier }) =>
      ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : '',
    )
    .filter((specifier) => /^\.\/.*\.cases(\.js)?$/.test(specifier))
    .map((specifier) =>
      resolve(dirname(specPath), specifier.replace(/\.js$/, '.ts')),
    );
  return [
    ...new Set([
      ...collectCategories(specFile),
      ...casesPaths.flatMap((path) => collectCategories(parse(path, read))),
    ]),
  ];
}

/** The text of a `###` section, up to the next heading. */
export function readSection(
  markdown: string,
  heading: string,
): string | undefined {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`### ${heading}`);
  if (start === -1) return undefined;
  const end = lines.findIndex(
    (line, index) => index > start && /^#{1,3} /.test(line),
  );
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

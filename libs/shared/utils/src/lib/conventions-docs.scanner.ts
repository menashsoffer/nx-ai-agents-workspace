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

/** The static name of a property key, however it is written; undefined if not static. */
function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isComputedPropertyName(name)) {
    return ts.isStringLiteralLike(name.expression)
      ? name.expression.text
      : undefined;
  }
  return ts.isIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Every `category` value under `node`; one that is not a literal is named as such. */
function collectCategories(node: ts.Node): string[] {
  const isCategory =
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    getPropertyName(node.name) === 'category';
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

/** The identifiers under `node` that refer to something (not property keys or members). */
function collectReferences(node: ts.Node): string[] {
  const isKey =
    ts.isIdentifier(node) &&
    ((ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
      (ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node));
  const own = ts.isIdentifier(node) && !isKey ? [node.text] : [];
  const inner: string[] = [];
  ts.forEachChild(
    node,
    (child) => void inner.push(...collectReferences(child)),
  );
  return [...own, ...inner];
}

/** The top-level variable or function a file declares under `name`. */
function findDeclaration(
  file: ts.SourceFile,
  name: string,
): ts.Node | undefined {
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement;
    }
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) => candidate.name.getText() === name,
      );
      if (declaration) return declaration;
    }
  }
  return undefined;
}

/** Where a relative named import of `localName` comes from, and what it is called there. */
function findImport(
  file: ts.SourceFile,
  localName: string,
): { path: string; exportedName: string } | undefined {
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('./')
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    const element =
      bindings && ts.isNamedImports(bindings)
        ? bindings.elements.find(
            (candidate) => candidate.name.text === localName,
          )
        : undefined;
    if (element) {
      return {
        path: resolve(
          dirname(file.fileName),
          statement.moduleSpecifier.text.replace(/\.js$/, '.ts'),
        ),
        exportedName: (element.propertyName ?? element.name).text,
      };
    }
  }
  return undefined;
}

/**
 * The categories of one symbol: its own declaration, plus whatever that
 * declaration refers to (a helper in the same file, or an import). Nothing
 * else in the file counts.
 */
function collectSymbolCategories(
  file: ts.SourceFile,
  name: string,
  read: SourceReader,
  visited: Set<string>,
): string[] {
  const key = `${file.fileName}#${name}`;
  if (visited.has(key)) return [];
  visited.add(key);
  const declaration = findDeclaration(file, name);
  if (declaration) {
    return [
      ...collectCategories(declaration),
      ...collectReferences(declaration).flatMap((reference) =>
        collectSymbolCategories(file, reference, read, visited),
      ),
    ];
  }
  const imported = findImport(file, name);
  return imported
    ? collectSymbolCategories(
        parse(imported.path, read),
        imported.exportedName,
        read,
        visited,
      )
    : [];
}

/** The categories of one table: written in place, declared in the spec, or imported. */
function collectTableCategories(
  table: ts.Node,
  specFile: ts.SourceFile,
  read: SourceReader,
): string[] {
  const visited = new Set<string>();
  return [
    ...collectCategories(table),
    ...collectReferences(table).flatMap((reference) =>
      collectSymbolCategories(specFile, reference, read, visited),
    ),
  ];
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

import ts from 'typescript';

// The colour and export-coverage audits of libs/ui (docs/conventions.md,
// "Convention audits"). Both read the TypeScript syntax tree, so a comment,
// JSX text or an indented / semicolonless statement is never mistaken for code.

const COLOUR_FUNCTION =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
// A `#` that starts a token (not a URL anchor); 5 and 7 digit runs are not colours.
const HEX_COLOUR =
  /(?<![\w/.])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/i;
const NAMED_COLOURS = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
    ' ',
  ),
);
const NAMED_COLOUR_ARBITRARY_VALUE = new RegExp(
  `-\\[(?:color:)?(?:${[...NAMED_COLOURS].join('|')})(?:/[\\d.]+)?\\]`,
  'i',
);
const COLOUR_PROPERTY = /color$|^(?:background|fill|stroke|border|outline)$/i;
const ANCHOR_PROPERTIES = new Set(['href', 'id', 'htmlFor', 'to']);

/** The name of the attribute or object key a literal is the value of, if any. */
function getOwnerName(literal: ts.Node): string | undefined {
  let owner = literal.parent;
  while (ts.isJsxExpression(owner) || ts.isParenthesizedExpression(owner)) {
    owner = owner.parent;
  }
  if (ts.isJsxAttribute(owner) || ts.isPropertyAssignment(owner)) {
    return owner.name.getText();
  }
  return undefined;
}

/** True if the source hard-codes a colour instead of using an `@theme` token class. */
export function hasHardCodedColour(sourceText: string): boolean {
  const sourceFile = ts.createSourceFile(
    'source.tsx',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let isFound = false;
  const visit = (node: ts.Node): void => {
    if (isFound) return;
    // Only literals are read: comments and JSX text are not in the tree as nodes.
    if (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node)) {
      const ownerName = getOwnerName(node)?.replace(/^['"]|['"]$/g, '');
      isFound =
        COLOUR_FUNCTION.test(node.text) ||
        NAMED_COLOUR_ARBITRARY_VALUE.test(node.text) ||
        (!ANCHOR_PROPERTIES.has(ownerName ?? '') &&
          HEX_COLOUR.test(node.text)) ||
        (ownerName !== undefined &&
          COLOUR_PROPERTY.test(ownerName) &&
          NAMED_COLOURS.has(node.text.trim().toLowerCase()));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return isFound;
}

export interface ExportedModule {
  specifier: string;
  isTypeOnly: boolean;
}

/**
 * Classifies every top-level `export` statement of an index file. One that is
 * not a relative `export ... from './...'` is returned in
 * `unrecognisedStatements` (its first line), never skipped.
 */
export function parseExportStatements(indexText: string): {
  modules: ExportedModule[];
  unrecognisedStatements: string[];
} {
  const sourceFile = ts.createSourceFile(
    'index.ts',
    indexText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const modules: ExportedModule[] = [];
  const unrecognisedStatements: string[] = [];
  for (const statement of sourceFile.statements) {
    const isExport =
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement) ||
      Boolean(
        ts.canHaveModifiers(statement) &&
        ts
          .getModifiers(statement)
          ?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword),
      );
    if (!isExport) continue;
    const exportClause =
      ts.isExportDeclaration(statement) && statement.exportClause;
    const specifier =
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
    if (
      !specifier.startsWith('./') ||
      !ts.isExportDeclaration(statement) ||
      (exportClause && !ts.isNamedExports(exportClause))
    ) {
      unrecognisedStatements.push(statement.getText().split('\n')[0]);
      continue;
    }
    const { elements } = (exportClause || { elements: [] }) as ts.NamedExports;
    modules.push({
      specifier,
      isTypeOnly:
        statement.isTypeOnly ||
        (elements.length > 0 && elements.every(({ isTypeOnly }) => isTypeOnly)),
    });
  }
  return { modules, unrecognisedStatements };
}

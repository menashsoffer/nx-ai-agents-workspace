// The colour and export-coverage audits of libs/ui (docs/conventions.md,
// "Convention audits"). Both read source text; neither parses TypeScript.

const COLOUR_FUNCTION =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
// A `#` that starts a token (not a URL anchor) and is not the value of an
// `href`/`id`-style attribute; 5 and 7 digit runs are not colours.
const HEX_COLOUR =
  /(?<![\w/.])(?<!\b(?:href|id|htmlFor|to)\s*=\s*[{"'`]*)#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/i;
const NAMED_COLOURS =
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
    .split(' ')
    .join('|');
const NAMED_COLOUR_ARBITRARY_VALUE = new RegExp(
  `-\\[(?:color:)?(?:${NAMED_COLOURS})(?:/[\\d.]+)?\\]`,
  'i',
);
const NAMED_COLOUR_STYLE_PROPERTY = new RegExp(
  `(?:\\b[a-zA-Z]*[cC]olor|\\bbackground|\\bfill|\\bstroke|\\bborder|\\boutline)['"]?\\s*:\\s*['"\`]\\s*(?:${NAMED_COLOURS})\\s*['"\`]`,
  'i',
);

/** True if the source hard-codes a colour instead of using an `@theme` token class. */
export function hasHardCodedColour(sourceText: string): boolean {
  return [
    COLOUR_FUNCTION,
    HEX_COLOUR,
    NAMED_COLOUR_ARBITRARY_VALUE,
    NAMED_COLOUR_STYLE_PROPERTY,
  ].some((pattern) => pattern.test(sourceText));
}

export interface ExportedModule {
  specifier: string;
  isTypeOnly: boolean;
}

const EXPORT_FROM =
  /^export\s+(type\s+)?(\*|\{([^}]*)\})\s+from\s+(['"])(\.\/[^'"]+)\4;?$/;

/**
 * Reads the `export ... from './...'` statements of an index file. A statement
 * that starts with `export` and is not one of the known forms is returned in
 * `unrecognisedStatements`, never skipped.
 */
export function parseExportStatements(indexText: string): {
  modules: ExportedModule[];
  unrecognisedStatements: string[];
} {
  const modules: ExportedModule[] = [];
  const unrecognisedStatements: string[] = [];
  for (const [statement] of indexText.matchAll(/^export\b[^;]*;?/gm)) {
    const match = EXPORT_FROM.exec(statement.replace(/\s+/g, ' ').trim());
    if (!match) {
      unrecognisedStatements.push(statement.trim().split('\n')[0]);
      continue;
    }
    const [, typeModifier, , specifiers = '*', , specifier] = match;
    modules.push({
      specifier,
      isTypeOnly:
        Boolean(typeModifier) ||
        (specifiers !== '*' &&
          specifiers
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .every((item) => item.startsWith('type '))),
    });
  }
  return { modules, unrecognisedStatements };
}

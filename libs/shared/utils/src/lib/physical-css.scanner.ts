// The RTL audit of plain CSS (docs/conventions.md, "Convention audits"): finds
// declarations that name a physical direction instead of a logical one.

const COMMENT_OR_STRING =
  /\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?/g;
const DECLARATION = /(?<=^|[;{}\s])(-{0,2}[a-z][\w-]*)\s*:\s*([^;{}]*)/gi;
const PHYSICAL_LONGHAND =
  /^(?:(?:margin|padding|scroll-margin|scroll-padding)-(?:left|right)|border-(?:left|right)(?:-(?:color|width|style))?|border-(?:top|bottom)-(?:left|right)-radius|left|right)$/;
const PHYSICAL_KEYWORD_PROPERTIES = new Set(['text-align', 'float', 'clear']);
const BOX_SHORTHANDS = new Set([
  'margin',
  'padding',
  'scroll-margin',
  'scroll-padding',
  'inset',
]);

/** Blanks comments and string contents, so offsets stay and neither is read as code. */
function maskCommentsAndStrings(cssText: string): string {
  return cssText.replace(COMMENT_OR_STRING, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
}

/** Splits a value on whitespace outside parentheses (`calc(1px + 2px)` is one value). */
function splitValues(value: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value.trim()) {
    if (character === '(') depth++;
    if (character === ')') depth--;
    if (/\s/.test(character) && depth === 0) {
      if (current) values.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  return current ? [...values, current] : values;
}

/** Returns one finding per physical declaration, e.g. `margin-left` or `clear: left`. */
export function findPhysicalCssProperties(cssText: string): string[] {
  const findings: string[] = [];
  for (const [, rawName, rawValue] of maskCommentsAndStrings(cssText).matchAll(
    DECLARATION,
  )) {
    const name = rawName.toLowerCase();
    const values = splitValues(rawValue.replace(/!important\s*$/i, '')).map(
      (value) => value.toLowerCase(),
    );
    if (PHYSICAL_LONGHAND.test(name)) {
      findings.push(name);
    } else if (
      PHYSICAL_KEYWORD_PROPERTIES.has(name) &&
      /^(?:left|right)$/.test(values[0] ?? '')
    ) {
      findings.push(`${name}: ${values[0]}`);
    } else if (
      BOX_SHORTHANDS.has(name) &&
      values.length === 4 &&
      values[1] !== values[3]
    ) {
      findings.push(`${name}: four values`);
    }
  }
  return findings;
}

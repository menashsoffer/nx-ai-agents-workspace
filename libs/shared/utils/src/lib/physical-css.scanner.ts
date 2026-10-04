// The RTL audit of plain CSS (docs/conventions.md, "Convention audits"): finds
// declarations that name a physical direction instead of a logical one.

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

const IDENTIFIER_START = /[A-Za-z_]|[^\0-\x7f]/;
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_-]|[^\0-\x7f]/;
const HEX_DIGIT = /[0-9a-fA-F]/;
const REPLACEMENT_CHARACTER = '\uFFFD';

/** A backslash that is not at the end of the input or before a newline. */
const isEscape = (text: string, at: number) =>
  text[at] === '\\' && at + 1 < text.length && text[at + 1] !== '\n';

/** Decodes the escape whose backslash is at `at`: [character, next position]. */
function readEscape(text: string, at: number): [string, number] {
  let end = at + 1;
  while (end - at <= 6 && HEX_DIGIT.test(text[end] ?? '')) end++;
  if (end === at + 1) return [text[end], end + 1];
  const codePoint = parseInt(text.slice(at + 1, end), 16);
  if (/[ \t\n]/.test(text[end] ?? '')) end++;
  const isValid =
    codePoint > 0 &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff);
  return [
    isValid ? String.fromCodePoint(codePoint) : REPLACEMENT_CHARACTER,
    end,
  ];
}

function readIdentifier(text: string, start: number): [string, number] {
  let name = '';
  let at = start;
  while (at < text.length) {
    if (IDENTIFIER_CHARACTER.test(text[at])) {
      name += text[at++];
    } else if (isEscape(text, at)) {
      const [character, next] = readEscape(text, at);
      // An escape may spell any character; one that cannot be part of a name
      // must not turn into a separator the declaration scan would split on.
      name += IDENTIFIER_CHARACTER.test(character)
        ? character
        : REPLACEMENT_CHARACTER;
      at = next;
    } else {
      break;
    }
  }
  return [name, at];
}

/** The index after the string whose opening quote is at `start`. */
function skipString(text: string, start: number): number {
  let at = start + 1;
  while (at < text.length && text[at] !== text[start] && text[at] !== '\n') {
    at += text[at] === '\\' ? 2 : 1;
  }
  return text[at] === text[start] ? at + 1 : at;
}

/** The index after the unquoted url( contents, which end at the first bare `)`. */
function skipUrl(text: string, start: number): number {
  let at = start;
  while (at < text.length && text[at] !== ')') {
    at += isEscape(text, at) ? 2 : 1;
  }
  return at + 1;
}

/**
 * Reads CSS the way a browser tokenizes it (CSS Syntax 3): comments become
 * a space, a string or an unquoted url() keeps no contents, and escapes in
 * names and keywords are decoded. `/*` inside a string or a url() is content,
 * not a comment opener, and `m\61rgin-left` is `margin-left`.
 */
function normaliseCss(cssText: string): string {
  const text = cssText
    .replace(/\r\n?|\f/g, '\n')
    .replace(/\0/g, REPLACEMENT_CHARACTER);
  let output = '';
  let at = 0;
  while (at < text.length) {
    const character = text[at];
    if (character === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2);
      at = end === -1 ? text.length : end + 2;
      output += ' ';
    } else if (character === '"' || character === "'") {
      at = skipString(text, at);
      output += '""';
    } else if (
      IDENTIFIER_START.test(character) ||
      isEscape(text, at) ||
      (character === '-' && /[-\w\\]/.test(text[at + 1] ?? ''))
    ) {
      const [name, next] = readIdentifier(text, at);
      at = next;
      output += name;
      if (text[at] === '(' && name.toLowerCase() === 'url') {
        let afterSpace = at + 1;
        while (/\s/.test(text[afterSpace] ?? '')) afterSpace++;
        const isQuoted = text[afterSpace] === '"' || text[afterSpace] === "'";
        output += isQuoted ? '(' : '()';
        at = isQuoted ? at + 1 : skipUrl(text, afterSpace);
      }
    } else {
      output += character;
      at++;
    }
  }
  return output;
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
  for (const [, rawName, rawValue] of normaliseCss(cssText).matchAll(
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

// A small CSS tokenizer (CSS Syntax Level 3, https://www.w3.org/TR/css-syntax-3/#tokenization)
// for finding the URLs a stylesheet makes the browser fetch. It reads CSS the
// way a browser does, which a regex over the source cannot:
//   - comments are dropped, but `/*` inside a string or a url() is not one;
//   - escapes are decoded everywhere (`\68 ttps:` is `https:`, `\75rl(` is `url(`);
//   - a quoted string ends at its own quote, so `url("a(b).png")` is whole.
// Whitespace and comments are not emitted: tokens that are only separated by
// them (`@import/**/"x"`) are neighbours in the result.
//
// Token types: `string`, `url` (unquoted url() contents), `bad-url` (a url()
// the spec rejects; the value is its raw contents), `function` and `at-keyword`
// (lower-cased names), `ident`, and `delim` for any other single character.

const WHITESPACE_CHARACTERS = new Set([' ', '\t', '\n']);
const IDENTIFIER_START_CHARACTER = /[A-Za-z_]|[^\0-\x7f]/;
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_-]|[^\0-\x7f]/;
const HEX_DIGIT = /[0-9a-fA-F]/;
const MAX_HEX_ESCAPE_DIGITS = 6;
const MAX_CODE_POINT = 0x10ffff;
const REPLACEMENT_CHARACTER = '�';

const isHexDigit = (character) =>
  character !== undefined && HEX_DIGIT.test(character);

/** Control characters a bare url() may not contain. */
function isNonPrintable(character) {
  const code = character.charCodeAt(0);
  return (
    code <= 0x08 ||
    code === 0x0b ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f
  );
}

/** CSS preprocessing: one newline kind, no NUL. */
function normalizeCssText(cssText) {
  return String(cssText)
    .replace(/\r\n?|\f/g, '\n')
    .replace(/\0/g, REPLACEMENT_CHARACTER);
}

/** True if `text[position]` starts an escape (a backslash not before a newline). */
function isValidEscape(text, position) {
  return (
    text[position] === '\\' &&
    position + 1 < text.length &&
    text[position + 1] !== '\n'
  );
}

/**
 * Decodes the escape whose backslash is at `position - 1`.
 * Returns [decoded character, next position].
 */
function parseEscape(text, position) {
  if (position >= text.length) return [REPLACEMENT_CHARACTER, position];
  if (!isHexDigit(text[position])) return [text[position], position + 1];
  let hexDigits = '';
  while (
    hexDigits.length < MAX_HEX_ESCAPE_DIGITS &&
    isHexDigit(text[position])
  ) {
    hexDigits += text[position++];
  }
  if (WHITESPACE_CHARACTERS.has(text[position])) position++;
  const codePoint = parseInt(hexDigits, 16);
  const isInvalid =
    codePoint === 0 ||
    codePoint > MAX_CODE_POINT ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff);
  return [
    isInvalid ? REPLACEMENT_CHARACTER : String.fromCodePoint(codePoint),
    position,
  ];
}

/** True if an identifier starts at `position`. */
function isIdentifierStart(text, position) {
  const first = text[position];
  if (first === undefined) return false;
  if (first === '-') {
    const second = text[position + 1];
    return (
      second !== undefined &&
      (IDENTIFIER_START_CHARACTER.test(second) ||
        second === '-' ||
        isValidEscape(text, position + 1))
    );
  }
  return (
    IDENTIFIER_START_CHARACTER.test(first) || isValidEscape(text, position)
  );
}

/** Parses an identifier at `position`. Returns [decoded name, next position]. */
function parseIdentifier(text, position) {
  let name = '';
  while (position < text.length) {
    if (IDENTIFIER_CHARACTER.test(text[position])) {
      name += text[position++];
    } else if (isValidEscape(text, position)) {
      const [character, nextPosition] = parseEscape(text, position + 1);
      name += character;
      position = nextPosition;
    } else {
      break;
    }
  }
  return [name, position];
}

/**
 * Parses a string whose opening quote is at `position`.
 * Returns [token, next position].
 */
function parseString(text, position) {
  const quote = text[position++];
  let value = '';
  while (position < text.length) {
    const character = text[position];
    if (character === quote) return [{ type: 'string', value }, position + 1];
    if (character === '\n') {
      return [{ type: 'bad-string', value }, position]; // unescaped newline
    }
    if (character === '\\') {
      if (position + 1 >= text.length) {
        return [{ type: 'string', value }, position + 1];
      }
      if (text[position + 1] === '\n') {
        position += 2; // line continuation
        continue;
      }
      const [decoded, nextPosition] = parseEscape(text, position + 1);
      value += decoded;
      position = nextPosition;
      continue;
    }
    value += character;
    position++;
  }
  return [{ type: 'string', value }, position];
}

/**
 * Parses the contents of an unquoted url( ... ) from `position`, just after
 * the `(`. Returns [token, next position].
 */
function parseUrl(text, position) {
  const start = position;
  let value = '';
  let isBadUrl = false;
  while (position < text.length) {
    const character = text[position];
    if (character === ')') return [{ type: 'url', value }, position + 1];
    if (WHITESPACE_CHARACTERS.has(character)) {
      while (WHITESPACE_CHARACTERS.has(text[position])) position++;
      if (position >= text.length) return [{ type: 'url', value }, position];
      if (text[position] === ')') return [{ type: 'url', value }, position + 1];
      isBadUrl = true; // whitespace inside the URL
      break;
    }
    if (
      character === '"' ||
      character === "'" ||
      character === '(' ||
      isNonPrintable(character)
    ) {
      isBadUrl = true;
      break;
    }
    if (character === '\\') {
      if (!isValidEscape(text, position)) {
        isBadUrl = true;
        break;
      }
      const [decoded, nextPosition] = parseEscape(text, position + 1);
      value += decoded;
      position = nextPosition;
      continue;
    }
    value += character;
    position++;
  }
  // Ran into the end of the input: the url is complete.
  if (!isBadUrl) return [{ type: 'url', value }, position];
  // A bad url: browsers do not fetch it, but its contents are still returned
  // (raw, up to the closing parenthesis) so that a check stays fail-closed.
  while (position < text.length && text[position] !== ')') {
    position += isValidEscape(text, position) ? 2 : 1;
  }
  const rawContents = text.slice(start, position).trim();
  return [{ type: 'bad-url', value: rawContents }, position + 1];
}

/** @returns {{ type: string, value: string }[]} */
export function tokenizeCss(cssText) {
  const text = normalizeCssText(cssText);
  const tokens = [];
  let position = 0;
  while (position < text.length) {
    const character = text[position];
    if (WHITESPACE_CHARACTERS.has(character)) {
      position++;
    } else if (character === '/' && text[position + 1] === '*') {
      const commentEnd = text.indexOf('*/', position + 2);
      position = commentEnd === -1 ? text.length : commentEnd + 2;
    } else if (character === '"' || character === "'") {
      const [token, nextPosition] = parseString(text, position);
      tokens.push(token);
      position = nextPosition;
    } else if (character === '@' && isIdentifierStart(text, position + 1)) {
      const [name, nextPosition] = parseIdentifier(text, position + 1);
      tokens.push({ type: 'at-keyword', value: name.toLowerCase() });
      position = nextPosition;
    } else if (isIdentifierStart(text, position)) {
      const [name, nextPosition] = parseIdentifier(text, position);
      position = nextPosition;
      if (text[position] !== '(') {
        tokens.push({ type: 'ident', value: name });
      } else if (name.toLowerCase() !== 'url') {
        tokens.push({ type: 'function', value: name.toLowerCase() });
        position++;
      } else {
        position++; // (
        let afterWhitespace = position;
        while (WHITESPACE_CHARACTERS.has(text[afterWhitespace])) {
          afterWhitespace++;
        }
        if (text[afterWhitespace] === '"' || text[afterWhitespace] === "'") {
          // url("...") is a function token followed by a string token.
          tokens.push({ type: 'function', value: 'url' });
          position = afterWhitespace;
        } else {
          const [token, urlEnd] = parseUrl(text, afterWhitespace);
          tokens.push(token);
          position = urlEnd;
        }
      }
    } else {
      tokens.push({ type: 'delim', value: character });
      position++;
    }
  }
  return tokens;
}

// The protection layer for uploaded files (excel-import-errors-spec-he.md, section 3). The
// database checks the same rules again; these checks exist so the admin sees the problem first.

/** Direction overrides can make text read differently from what it is. */
const BIDI_OVERRIDE = /[\u202A-\u202E\u2066-\u2069]/g;

/** C0 control characters other than tab and line breaks, and DEL. Postgres refuses NUL. */
function isControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code < 32 && char !== '\t' && char !== '\n' && char !== '\r') || code === 127;
}

/** A cell as it is kept: without invisible characters that only cause harm. */
export function cleanCell(text: string): string {
  const visible = Array.from(text.replace(BIDI_OVERRIDE, '')).filter((c) => !isControl(c));
  return visible.join('');
}

/** A value Excel or another spreadsheet would run as a formula when the data is exported. */
export function looksLikeFormula(text: string): boolean {
  return /^[=@\t\r]/.test(text) || /^[+-](?![\d\s(])/.test(text);
}

/** Markup or a script address: harmless on this site, but never supplier data. */
export function looksLikeCode(text: string): boolean {
  return /<\s*[a-z!/?]/i.test(text) || /\b(javascript|vbscript|data)\s*:/i.test(text);
}

export const MAX_CELL = 2000;
export const MAX_COLUMNS = 200;

/** Why a value is refused, or null when it may be imported. */
export function unsafeReason(text: string): string | null {
  if (text.length > MAX_CELL) return 'הערך ארוך מדי';
  if (looksLikeFormula(text)) return 'נראה כמו נוסחה של אקסל, ולכן לא נקלט';
  if (looksLikeCode(text)) return 'נראה כמו קוד, ולכן לא נקלט';
  return null;
}

/** Parts of a workbook that hold code or links to other files. A supplier list needs none. */
const ACTIVE_PARTS =
  /(^|\/)(vbaProject\.bin|macrosheets\/|activeX\/|embeddings\/|externalLinks\/)/i;

export function hasActiveContent(names: readonly string[]): boolean {
  return names.some((name) => ACTIVE_PARTS.test(name) || name.includes('..'));
}

/** XML with a document type can expand entities without end; Excel never writes one. */
export const hasDoctype = (xml: string) => /<!(DOCTYPE|ENTITY)/i.test(xml);

/** An .xlsx file is a zip archive, which starts with "PK\x03\x04". */
export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** A text file has no NUL byte; a binary file renamed to .csv does. */
export const isBinary = (bytes: Uint8Array) => bytes.subarray(0, 65_536).includes(0);

export type FileProblem =
  'type' | 'size' | 'empty' | 'unreadable' | 'disguised' | 'active' | 'bomb' | 'columns';

/** A file refused as a whole, with the reason the screen explains. */
export class FileRefusal extends Error {
  readonly problem: FileProblem;
  constructor(problem: FileProblem) {
    super(`file: ${problem}`);
    this.problem = problem;
  }
}

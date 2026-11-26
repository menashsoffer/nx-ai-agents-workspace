// Reads a .csv file as rows of text. Excel in Hebrew often saves CSV as Windows-1255, not UTF-8,
// so a file that is not valid UTF-8 is read again in that encoding.

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1255').decode(bytes);
  }
}

/** The separator that splits the first line into the most fields: comma, semicolon or tab. */
export function separatorOf(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((sep) => [sep, first.split(sep).length] as const);
  return counts.reduce((best, next) => (next[1] > best[1] ? next : best))[0];
}

interface State {
  sep: string;
  rows: string[][];
  row: string[];
  field: string;
  quoted: boolean;
}

function endField(state: State): void {
  state.row.push(state.field.trim());
  state.field = '';
}

function endRow(state: State): void {
  endField(state);
  state.rows.push(state.row);
  state.row = [];
}

/** One character inside quotes; returns how many extra characters it used. */
function quotedChar(state: State, char: string, next: string | undefined): number {
  if (char !== '"') state.field += char;
  else if (next === '"') {
    state.field += '"';
    return 1;
  } else state.quoted = false;
  return 0;
}

function plainChar(state: State, char: string, next: string | undefined): number {
  if (char === '"' && state.field === '') state.quoted = true;
  else if (char === state.sep) endField(state);
  else if (char === '\n' || char === '\r') {
    endRow(state);
    return char === '\r' && next === '\n' ? 1 : 0;
  } else state.field += char;
  return 0;
}

/** RFC 4180 fields: quotes around a field, doubled quotes inside it, line breaks inside quotes. */
export function parseCsv(text: string, separator = separatorOf(text)): string[][] {
  const state: State = { sep: separator, rows: [], row: [], field: '', quoted: false };
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    const next = text[i + 1];
    i += state.quoted ? quotedChar(state, char, next) : plainChar(state, char, next);
  }
  if (state.field !== '' || state.row.length > 0) endRow(state);
  return state.rows;
}

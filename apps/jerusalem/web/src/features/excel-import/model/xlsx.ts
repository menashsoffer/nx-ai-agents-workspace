// Reads the sheets of an .xlsx workbook as rows of text (spec section 4): every cell stays the
// text Excel shows for it, numbers keep their digits, and a date cell becomes YYYY-MM-DD.
import { FileRefusal, hasActiveContent, hasDoctype } from './safety.ts';
import { readZipText, zipNames, ZipError } from './zip.ts';

export interface Sheet {
  name: string;
  rows: string[][];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code] ?? whole;
    })
    .replace(/_x([0-9A-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** All <t> texts inside one element, joined: plain and rich-text strings alike. */
function texts(xml: string): string {
  const parts = [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)];
  return decodeXml(parts.map((m) => m[1] ?? '').join(''));
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1] ?? ''));
}

const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);

/** For each cell style index, whether it shows a date. */
export function dateStyles(xml: string | undefined): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(Number(m[1]), decodeXml(m[2] ?? ''));
  }
  const cellXfs = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? '';
  return [...cellXfs.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].map((m) => {
    const id = Number(m[1]);
    const code = (custom.get(id) ?? '').replace(/\[[^\]]*\]|"[^"]*"/g, '');
    return DATE_FORMAT_IDS.has(id) || (/[dy]/i.test(code) && !/[h]/i.test(code));
  });
}

/** An Excel serial day (1900 system) as YYYY-MM-DD. */
export function serialDate(serial: number): string {
  return new Date(Math.round((serial - 25_569) * 86_400_000)).toISOString().slice(0, 10);
}

export function columnIndex(ref: string): number {
  let index = 0;
  for (const letter of ref.replace(/\d+$/, '')) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

interface Context {
  strings: string[];
  dates: boolean[];
}

function typedValue(type: string, value: string, context: Context): string | null {
  if (type === 's') return context.strings[Number(value)] ?? '';
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  return null;
}

const attr = (attrs: string, name: string) =>
  new RegExp(`\\b${name}="([^"]+)"`).exec(attrs)?.[1] ?? '';

function cellValue(attrs: string, body: string, context: Context): string {
  const type = attr(attrs, 't') || 'n';
  if (type === 'inlineStr') return texts(body);
  const value = decodeXml(/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? '');
  const typed = typedValue(type, value, context);
  if (typed !== null) return typed;
  const date = type === 'n' && value !== '' && context.dates[Number(attr(attrs, 's'))] === true;
  return date ? serialDate(Number(value)) : value;
}

function rowCells(xml: string, context: Context): string[] {
  const cells: string[] = [];
  for (const cell of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = cell[1] ?? '';
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
    cells[ref ? columnIndex(ref) : cells.length] = cellValue(attrs, cell[2] ?? '', context).trim();
  }
  return Array.from(cells, (value: string | undefined) => value ?? '');
}

export function sheetRows(xml: string, context: Context): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const number = Number(/\br="(\d+)"/.exec(row[1] ?? '')?.[1] ?? rows.length + 1);
    rows[number - 1] = rowCells(row[2] ?? '', context);
  }
  return Array.from(rows, (value: string[] | undefined) => value ?? []);
}

function sheetTargets(workbook: string, rels: string): { name: string; path: string }[] {
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) {
    targets.set(m[1] ?? '', (m[2] ?? '').replace(/^\/?(xl\/)?/, 'xl/'));
  }
  return [...workbook.matchAll(/<sheet\b[^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"/g)].map((m) => ({
    name: decodeXml(m[1] ?? ''),
    path: targets.get(m[2] ?? '') ?? '',
  }));
}

async function workbookParts(bytes: Uint8Array): Promise<Map<string, string>> {
  try {
    if (hasActiveContent(zipNames(bytes))) throw new FileRefusal('active');
    const wanted = (name: string) => name.startsWith('xl/') && /\.(xml|rels)$/.test(name);
    const files = await readZipText(bytes, wanted);
    if ([...files.values()].some(hasDoctype)) throw new FileRefusal('active');
    return files;
  } catch (error) {
    if (error instanceof FileRefusal) throw error;
    const bomb = error instanceof ZipError && error.problem === 'bomb';
    throw new FileRefusal(bomb ? 'bomb' : 'unreadable');
  }
}

/** Every sheet in the workbook, in order, each as rows of text cells. */
export async function readWorkbook(bytes: Uint8Array): Promise<Sheet[]> {
  const files = await workbookParts(bytes);
  const rels = files.get('xl/_rels/workbook.xml.rels');
  const workbook = files.get('xl/workbook.xml');
  if (!rels || !workbook) throw new FileRefusal('unreadable');
  const context = {
    strings: sharedStrings(files.get('xl/sharedStrings.xml')),
    dates: dateStyles(files.get('xl/styles.xml')),
  };
  return sheetTargets(workbook, rels).map(({ name, path }) => ({
    name,
    rows: sheetRows(files.get(path) ?? '', context),
  }));
}

// Opens the chosen file: checks its type, size and content, then reads it as sheets of text
// (excel-import-errors-spec-he.md, section 3.1).
import { decodeText, parseCsv } from './csv.ts';
import { MAX_BYTES } from './rows.ts';
import { FileRefusal, isBinary, isZip, MAX_COLUMNS, type FileProblem } from './safety.ts';
import type { Sheet } from './xlsx.ts';

export type { FileProblem };

/** Each refusal says what is wrong and what to do (error-handling-spec-he.md). */
export const FILE_PROBLEMS: Record<FileProblem, string> = {
  type: 'אפשר לקלוט רק קובץ .xlsx או .csv. קובץ .xls ישן או קובץ עם מאקרו צריך לשמור מחדש כ-.xlsx.',
  size: 'הקובץ גדול מ-5 MB. צריך לפצל אותו לכמה קבצים.',
  empty: 'לא נמצאו בקובץ שורות עם נתונים. כדאי לבדוק שבחרת את הקובץ הנכון.',
  unreadable: 'לא הצלחנו לקרוא את הקובץ. כדאי לפתוח אותו באקסל ולשמור מחדש כ-.xlsx.',
  disguised: 'סוג הקובץ לא תואם לסיומת שלו. צריך לפתוח אותו באקסל ולשמור מחדש כ-.xlsx או .csv.',
  active:
    'הקובץ מכיל מאקרו, קוד או קישורים לקבצים אחרים, ולכן הוא לא נקלט. ' +
    'צריך להעתיק את הנתונים לתבנית ולהעלות אותה.',
  bomb: 'הקובץ נפתח לגודל חריג. כדאי להעתיק את הנתונים לתבנית ולהעלות אותה.',
  columns: 'בקובץ יותר מ-200 עמודות. צריך להשאיר רק את עמודות הספקים.',
};

export interface OpenedFile {
  name: string;
  kind: 'xlsx' | 'csv';
  bytes: Uint8Array<ArrayBuffer>;
  sheets: Sheet[];
}

export function kindOf(name: string): 'xlsx' | 'csv' | null {
  const ext = /\.([a-z]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext === 'xlsx' || ext === 'csv' ? ext : null;
}

async function sheetsOf(kind: 'xlsx' | 'csv', name: string, bytes: Uint8Array) {
  if (kind === 'xlsx') {
    if (!isZip(bytes)) throw new FileRefusal('disguised');
    return (await import('./xlsx.ts')).readWorkbook(bytes);
  }
  if (isZip(bytes) || isBinary(bytes)) throw new FileRefusal('disguised');
  return [{ name, rows: parseCsv(decodeText(bytes)) }];
}

function contentProblem(sheets: Sheet[]): FileProblem | null {
  if (!sheets.some((sheet) => sheet.rows.some((row) => row.some(Boolean)))) return 'empty';
  const wide = sheets.some((sheet) => sheet.rows.some((row) => row.length > MAX_COLUMNS));
  return wide ? 'columns' : null;
}

/** The file's sheets, or the problem to show. The xlsx reader loads only when it is needed. */
export async function openFile(file: File): Promise<OpenedFile | FileProblem> {
  const kind = kindOf(file.name);
  if (!kind) return 'type';
  if (file.size > MAX_BYTES) return 'size';
  if (file.size === 0) return 'empty';
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const sheets = await sheetsOf(kind, file.name, bytes);
    return contentProblem(sheets) ?? { name: file.name, kind, bytes, sheets };
  } catch (error) {
    return error instanceof FileRefusal ? error.problem : 'unreadable';
  }
}

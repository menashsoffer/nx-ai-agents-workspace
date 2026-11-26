// The downloadable template (spec section 5): sheet "ספקים" with the fixed headers and sheet
// "הנחיות" with what each column takes and one example row.
import { FIELDS, HEADERS } from './columns.ts';
import { writeZip } from './zip.ts';

const GUIDE: [string, string, string][] = [
  ['שם ספק', 'חובה. הכתיב כפי שמופיע במקור.', 'אבי שירותי הנדסה בע״מ'],
  ['סוג ספק', 'חברה, חל״צ, עמותה, שותפות, אגודה שיתופית, עוסק, גוף ציבורי, לא ידוע', 'חברה'],
  ['סוג מזהה', 'ח.פ., ע.ר., עוסק מורשה או ת.ז. לא מסיקים סוג מצורת המספר.', 'ח.פ.'],
  ['מספר מזהה', '5 עד 9 ספרות. נכנס כמועמד לבדיקה, לא כמזהה מאומת.', '012345678'],
  ['תחום', 'נוסח התחום כפי שמופיע במאגר.', 'תכנון ופיקוח'],
  ['טלפון', 'מספר אחד בתא.', '02-1234567'],
  ['דוא״ל', 'כתובת אחת בתא.', 'office@example.co.il'],
  ['כתובת', 'רחוב, מספר ויישוב.', 'יפו 1, ירושלים'],
  ['איש קשר', 'שם איש הקשר.', 'אבי כהן'],
  ['אתר', 'מתחיל ב-https:// או http://', 'https://example.co.il'],
  ['הערה', 'נשמרת כפי שהיא ואינה הופכת לשדה ספק.', ''],
];

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function cell(column: number, row: number, text: string): string {
  const ref = `${String.fromCharCode(65 + column)}${String(row)}`;
  return `<c r="${ref}" t="inlineStr" s="1"><is><t>${escape(text)}</t></is></c>`;
}

function sheet(rows: string[][]): string {
  const line = (cells: string[], r: number) =>
    `<row r="${String(r + 1)}">${cells.map((t, c) => cell(c, r + 1, t)).join('')}</row>`;
  const body = rows.map(line).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>' +
    '<cols><col min="1" max="11" width="22" style="1" customWidth="1"/></cols>' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

const NS = 'http://schemas.openxmlformats.org';
const REL = `${NS}/officeDocument/2006/relationships`;
const OFFICE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const SHEET_TYPE = `${OFFICE}.worksheet+xml`;
const RELS_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';

/** Text cells (format "@"), so identifier numbers typed into the template keep leading zeros. */
const STYLES =
  `<styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="1"><font/></fonts>` +
  '<fills count="1"><fill/></fills><borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/>' +
  '<xf numFmtId="49" applyNumberFormat="1"/></cellXfs></styleSheet>';

/** The template workbook as .xlsx bytes. */
export function templateWorkbook(): Uint8Array<ArrayBuffer> {
  const suppliers = sheet([FIELDS.map((field) => HEADERS[field])]);
  const guide = sheet([['עמודה', 'מה לכתוב', 'דוגמה'], ...GUIDE]);
  return writeZip([
    [
      '[Content_Types].xml',
      `<Types xmlns="${NS}/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="${RELS_TYPE}"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/xl/workbook.xml" ContentType="${OFFICE}.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${SHEET_TYPE}"/>` +
        `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="${SHEET_TYPE}"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="${OFFICE}.styles+xml"/>` +
        '</Types>',
    ],
    [
      '_rels/.rels',
      `<Relationships xmlns="${NS}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    ],
    [
      'xl/workbook.xml',
      `<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>` +
        '<sheet name="ספקים" sheetId="1" r:id="rId1"/>' +
        '<sheet name="הנחיות" sheetId="2" r:id="rId2"/>' +
        '</sheets></workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<Relationships xmlns="${NS}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/>` +
        `<Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ],
    ['xl/worksheets/sheet1.xml', suppliers],
    ['xl/worksheets/sheet2.xml', guide],
    ['xl/styles.xml', STYLES],
  ]);
}

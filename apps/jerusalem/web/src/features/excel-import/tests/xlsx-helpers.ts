// Builds small .xlsx files for tests, compressed the way Excel saves them.
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../model/zip.ts';

function u16(n: number) {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number) {
  return [...u16(n & 0xffff), ...u16(n >>> 16)];
}

/** A zip archive with every entry deflated (method 8). */
export function deflatedZip(files: [string, string][]): Uint8Array<ArrayBuffer> {
  const local: number[] = [];
  const central: number[] = [];
  for (const [name, text] of files) {
    const path = [...new TextEncoder().encode(name)];
    const data = new TextEncoder().encode(text);
    const packed = [...deflateRawSync(data)];
    const sizes = [...u32(crc32(data)), ...u32(packed.length), ...u32(data.length)];
    const offset = local.length;
    local.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u32(0), ...sizes);
    local.push(...u16(path.length), ...u16(0), ...path, ...packed);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u32(0));
    central.push(...sizes, ...u16(path.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0));
    central.push(...u32(0), ...u32(offset), ...path);
  }
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length)];
  end.push(...u16(files.length), ...u32(central.length), ...u32(local.length), ...u16(0));
  return new Uint8Array([...local, ...central, ...end]);
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A one-sheet workbook with shared strings, a dated cell style and the given sheet body. */
export function workbook(sheetData: string, strings: string[]): Uint8Array<ArrayBuffer> {
  const shared = strings.map((s) => `<si>${s}</si>`).join('');
  return deflatedZip([
    [
      'xl/workbook.xml',
      `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>` +
        '<sheet name="ספקים &amp; עוד" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="rId1" Type="x" Target="/xl/worksheets/sheet1.xml"/>' +
        '</Relationships>',
    ],
    ['xl/sharedStrings.xml', `<sst>${shared}</sst>`],
    [
      'xl/styles.xml',
      '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>' +
        '<numFmt numFmtId="165" formatCode="hh:mm"/></numFmts>' +
        '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/><xf numFmtId="165"/>' +
        '</cellXfs></styleSheet>',
    ],
    ['xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheetData}</sheetData></worksheet>`],
  ]);
}

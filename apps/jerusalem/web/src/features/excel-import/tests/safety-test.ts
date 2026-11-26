import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openFile } from '../model/read.ts';
import { tableOf } from '../model/rows.ts';
import {
  cleanCell,
  hasActiveContent,
  hasDoctype,
  isBinary,
  looksLikeCode,
  looksLikeFormula,
  unsafeReason,
} from '../model/safety.ts';
import { editedRow } from '../model/values.ts';
import { readZipText, MAX_UNPACKED, ZipError } from '../model/zip.ts';
import { deflatedZip, workbook } from './xlsx-helpers.ts';

const xlsx = (bytes: Uint8Array<ArrayBuffer>) => new File([bytes], 'a.xlsx');

describe('values that could run or mislead', () => {
  it('spots spreadsheet formulas but keeps phone numbers and negative amounts', () => {
    for (const bad of ['=HYPERLINK("x")', '@SUM(A1)', '+cmd|x', '-cmd', '\t=1']) {
      assert.equal(looksLikeFormula(bad), true, bad);
    }
    for (const good of ['+972-2-1234567', '-5', '- רווח', 'שם רגיל']) {
      assert.equal(looksLikeFormula(good), false, good);
    }
  });
  it('spots markup and script addresses', () => {
    assert.equal(looksLikeCode('<script>alert(1)</script>'), true);
    assert.equal(looksLikeCode('< img src=x>'), true);
    assert.equal(looksLikeCode('javascript:alert(1)'), true);
    assert.equal(looksLikeCode('3 < 5 ספקים'), false);
    assert.equal(unsafeReason('x'.repeat(2001)), 'הערך ארוך מדי');
    assert.equal(unsafeReason('שם'), null);
  });
  it('removes control and direction-override characters from every cell', () => {
    assert.equal(cleanCell('א\u0000ב‮ג\u0007\tד\n'), 'אבג\tד\n');
    const table = tableOf([['שם ספק'], ['ספק\u0000']]);
    assert.equal(table.rows[0]?.cells[0], 'ספק');
  });
  it('leaves an unsafe value out of the import and says why', () => {
    const { edited, issues } = editedRow({
      name: '=1+1',
      website: 'javascript:alert(1)',
      email: '<b>a@b.co</b>',
      phone: '021234567',
    });
    assert.deepEqual(edited, { phone: '021234567' });
    assert.deepEqual(
      issues.map((i) => i.field),
      ['name', 'website', 'email', 'name'],
    );
  });
});

describe('files that are refused as a whole', () => {
  it('refuses macros, embedded objects, links to other files and unsafe paths', async () => {
    assert.equal(hasActiveContent(['xl/vbaProject.bin']), true);
    assert.equal(hasActiveContent(['xl/embeddings/oleObject1.bin']), true);
    assert.equal(hasActiveContent(['xl/externalLinks/externalLink1.xml']), true);
    assert.equal(hasActiveContent(['../evil.xml']), true);
    assert.equal(hasActiveContent(['xl/workbook.xml']), false);
    const macro = deflatedZip([
      ['xl/vbaProject.bin', 'x'],
      ['xl/workbook.xml', '<workbook/>'],
    ]);
    assert.equal(await openFile(xlsx(macro)), 'active');
  });
  it('refuses XML with a document type (entity expansion)', async () => {
    assert.equal(hasDoctype('<?xml?><!DOCTYPE x [<!ENTITY a "b">]>'), true);
    const bytes = workbook('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', ['<t>א</t>']);
    assert.equal(typeof (await openFile(xlsx(bytes))), 'object');
    const evil = deflatedZip([['xl/workbook.xml', '<!DOCTYPE w [<!ENTITY a "aaaa">]><w>&a;</w>']]);
    assert.equal(await openFile(xlsx(evil)), 'active');
  });
  it('refuses a file that unpacks far beyond its size', async () => {
    const bomb = deflatedZip([['xl/workbook.xml', '0'.repeat(MAX_UNPACKED + 1)]]);
    assert.ok(bomb.length < 5 * 1024 * 1024);
    await assert.rejects(
      readZipText(bomb, () => true),
      (e) => e instanceof ZipError,
    );
    assert.equal(await openFile(xlsx(bomb)), 'bomb');
  });
  it('refuses a file whose content does not match its extension', async () => {
    assert.equal(isBinary(new Uint8Array([0x41, 0])), true);
    assert.equal(await openFile(new File([new Uint8Array([0x41, 0, 0x42])], 'a.csv')), 'disguised');
    const zip = deflatedZip([['a.xml', 'x']]);
    assert.equal(await openFile(new File([zip], 'a.csv')), 'disguised');
  });
  it('refuses more than 200 columns', async () => {
    const wide = `${Array.from({ length: 201 }, (_, i) => `c${String(i)}`).join(',')}\n`;
    assert.equal(await openFile(new File([wide], 'a.csv')), 'columns');
  });
});

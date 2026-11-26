import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeText, parseCsv, separatorOf } from '../model/csv.ts';
import { FILE_PROBLEMS, kindOf, openFile } from '../model/read.ts';
import { templateWorkbook } from '../model/template.ts';
import { columnIndex, decodeXml, readWorkbook, serialDate } from '../model/xlsx.ts';
import { readZipText, writeZip, ZipError } from '../model/zip.ts';
import { HEADERS, FIELDS } from '../model/columns.ts';
import { workbook } from './xlsx-helpers.ts';

const SHEET =
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
  '<row r="3"><c r="A3" t="inlineStr"><is><t>ספק &quot;א&quot;</t></is></c>' +
  '<c r="B3"><v>12345678</v></c><c r="C3" s="1"><v>46000</v></c><c r="D3" s="3"><v>0.5</v></c>' +
  '<c r="E3" t="b"><v>1</v></c><c r="F3" t="str"><v>a_x000D_b</v></c><c r="G3"/></row>';

describe('reading xlsx', () => {
  it('reads shared, inline, rich, number, date and boolean cells as text', async () => {
    const bytes = workbook(SHEET, [
      '<t>שם ספק</t>',
      '<r><t>תא</t></r><r><t>ריך</t></r><rPh><t>x</t></rPh>',
    ]);
    const [sheet] = await readWorkbook(bytes);
    assert.equal(sheet?.name, 'ספקים & עוד');
    assert.deepEqual(sheet.rows[0], ['שם ספק', '', 'תאריך']);
    assert.deepEqual(sheet.rows[1], []);
    assert.deepEqual(sheet.rows[2], [
      'ספק "א"',
      '12345678',
      '2025-12-09',
      '0.5',
      'TRUE',
      'a\rb',
      '',
    ]);
  });
  it('rejects a file that is not a workbook', async () => {
    await assert.rejects(readWorkbook(new Uint8Array([1, 2, 3])), /file: unreadable/);
    await assert.rejects(readWorkbook(writeZip([['a.txt', 'x']])), /file: unreadable/);
  });
  it('reads the template it writes, right to left, with text-formatted columns', async () => {
    const sheets = await readWorkbook(templateWorkbook());
    assert.deepEqual(
      sheets.map((s) => s.name),
      ['ספקים', 'הנחיות'],
    );
    assert.deepEqual(
      sheets[0]?.rows[0],
      FIELDS.map((f) => HEADERS[f]),
    );
    assert.equal(sheets[1]?.rows.length, 12);
  });
  it('decodes entities, columns and dates', () => {
    assert.equal(decodeXml('&#x5D0;&#1489;&amp;&bogus;'), 'אב&&bogus;');
    assert.equal(columnIndex('AB12'), 27);
    assert.equal(serialDate(25569), '1970-01-01');
  });
});

describe('zip', () => {
  it('round-trips stored entries and refuses broken archives', async () => {
    const zip = writeZip([
      ['a.xml', 'שלום'],
      ['b.xml', 'x'],
    ]);
    const read = await readZipText(zip, (name) => name === 'a.xml');
    assert.deepEqual([...read], [['a.xml', 'שלום']]);
    await assert.rejects(
      readZipText(new Uint8Array(30), () => true),
      ZipError,
    );
    const broken = zip.slice();
    broken[0] = 0;
    await assert.rejects(
      readZipText(broken, () => true),
      ZipError,
    );
  });
});

describe('reading csv', () => {
  it('splits quoted fields, doubled quotes and line breaks inside quotes', () => {
    const text = 'שם,טלפון\r\n"ספק, בע""מ","02-1\n2"\nאחר,03\n';
    assert.deepEqual(parseCsv(text), [
      ['שם', 'טלפון'],
      ['ספק, בע"מ', '02-1\n2'],
      ['אחר', '03'],
    ]);
    assert.deepEqual(parseCsv('a;b\n1;2'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
    assert.equal(separatorOf('a\tb\tc'), '\t');
  });
  it('reads UTF-8 with a byte order mark, and Windows-1255 from Hebrew Excel', () => {
    assert.equal(decodeText(new TextEncoder().encode('﻿שם')), 'שם');
    assert.equal(decodeText(new Uint8Array([0xf9, 0xed])), 'שם');
  });
});

describe('opening a file', () => {
  it('accepts only xlsx and csv files up to 5 MB with data', async () => {
    assert.equal(kindOf('a.XLSX'), 'xlsx');
    assert.equal(kindOf('a.xls'), null);
    assert.equal(await openFile(new File(['x'], 'a.xlsm')), 'type');
    assert.equal(await openFile(new File([], 'a.csv')), 'empty');
    assert.equal(await openFile(new File([',,\n,'], 'a.csv')), 'empty');
    assert.equal(await openFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.csv')), 'size');
    assert.equal(await openFile(new File(['junk'], 'a.xlsx')), 'disguised');
    assert.equal(
      await openFile(new File([new Uint8Array([0x50, 0x4b, 3, 4, 0])], 'a.xlsx')),
      'unreadable',
    );
    assert.ok(FILE_PROBLEMS.unreadable);
  });
  it('reads a csv and a workbook', async () => {
    const csv = await openFile(new File(['שם ספק\nא'], 'a.csv'));
    assert.ok(typeof csv !== 'string');
    assert.deepEqual(csv.sheets[0]?.rows, [['שם ספק'], ['א']]);
    const xlsx = await openFile(new File([templateWorkbook()], 't.xlsx'));
    assert.ok(typeof xlsx !== 'string');
    assert.equal(xlsx.kind, 'xlsx');
  });
});

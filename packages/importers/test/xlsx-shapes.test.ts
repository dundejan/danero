import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseEtoroXlsx, sniffEtoroXlsx } from '../src/etoro/xlsx';
import {
  loadXlsxWorkbook,
  stripNamespacePrefixes,
  XlsxUnreadableError,
  XlsxWorkbookError,
} from '../src/xlsx';
import { buildEtoroHappyPath } from './fixtures/etoro';
import {
  buildUnreadableWorkbook,
  buildWordDocument,
  withNamespacePrefixes,
} from './fixtures/xlsx-shapes';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

describe('sešit s prefixy jmenných prostorů (.NET OpenXML SDK)', () => {
  it('samotný exceljs ho nepřečte — proto ho import přepisuje', async () => {
    const prefixed = await withNamespacePrefixes(await buildEtoroHappyPath());
    await expect(
      new ExcelJS.Workbook().xlsx.load(prefixed as unknown as ArrayBuffer),
    ).rejects.toThrow();
  });

  it('výpis z eToro se načte a přečte stejně jako s výchozím jmenným prostorem', async () => {
    const plain = await buildEtoroHappyPath();
    const prefixed = await withNamespacePrefixes(plain);

    const workbook = await loadXlsxWorkbook(prefixed);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
      (await loadXlsxWorkbook(plain)).worksheets.map((sheet) => sheet.name),
    );
    expect(sniffEtoroXlsx(workbook)).toBe(true);

    const expected = await parseEtoroXlsx(plain);
    const actual = await parseEtoroXlsx(prefixed);
    expect(actual.errors).toEqual(expected.errors);
    expect(actual.transactions.length).toBeGreaterThan(0);
    expect(JSON.stringify(actual.transactions)).toBe(JSON.stringify(expected.transactions));
  });

  it('běžný sešit jde do exceljs beze změny', () => {
    const xml = `<?xml version="1.0"?><workbook xmlns="${MAIN}" xmlns:r="${RELS}"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    expect(stripNamespacePrefixes(xml)).toBeNull();
  });

  it('prefix se sundá jen prvkům ze jmenných prostorů, které exceljs čte bez něj', () => {
    const xml =
      `<x:workbook xmlns:x="${MAIN}" xmlns:d2p1="${RELS}" xmlns:mc="urn:jine">` +
      `<x:sheets><x:sheet name="A" sheetId="1" d2p1:id="rId1"/></x:sheets>` +
      `<mc:AlternateContent/></x:workbook>`;
    expect(stripNamespacePrefixes(xml)).toBe(
      `<workbook xmlns:x="${MAIN}" xmlns:d2p1="${RELS}" xmlns:mc="urn:jine">` +
        `<sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets>` +
        `<mc:AlternateContent/></workbook>`,
    );
  });
});

describe('deklarace jmenných prostorů v různém zápisu', () => {
  it('deklarace v apostrofech platí stejně jako v uvozovkách', () => {
    const xml = `<x:workbook xmlns:x='${MAIN}'><x:sheets/></x:workbook>`;
    expect(stripNamespacePrefixes(xml)).toBe(`<workbook xmlns:x='${MAIN}'><sheets/></workbook>`);
  });

  it('prefix `r` obsazený jiným jmenným prostorem se nepřepisuje — atributy by se smíchaly', () => {
    const xml =
      `<workbook xmlns="${MAIN}" xmlns:r="urn:jine" xmlns:d2p1="${RELS}">` +
      `<sheets><sheet r:foo="1" d2p1:id="rId1"/></sheets></workbook>`;
    expect(stripNamespacePrefixes(xml)).toBeNull();
  });
});

describe('přepis je jeden průchod, ať je deklarací kolik chce (bezpečnostní revize)', () => {
  it('tisíce deklarací a neuzavřených uvozovek nad velkou částí doběhnou rychle', () => {
    const declarations = Array.from({ length: 20_000 }, (_, i) => ` xmlns:p${i}="${MAIN}"`).join('');
    const unclosed = ' xmlns:z="'.repeat(20_000);
    const body = '<x:c r="A1"><x:v>1</x:v></x:c>'.repeat(50_000);
    const xml = `<x:worksheet xmlns:x="${MAIN}"${declarations}${unclosed}><x:sheetData>${body}</x:sheetData></x:worksheet>`;
    const started = performance.now();
    const out = stripNamespacePrefixes(xml);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out).toContain('<sheetData><c r="A1"><v>1</v></c>');
  });
});

describe('co je vada souboru a co naše', () => {
  it('sešit, který exceljs nepřečte, je XlsxWorkbookError — import si ho schová', async () => {
    const broken = await buildUnreadableWorkbook();
    const error = await loadXlsxWorkbook(broken).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XlsxWorkbookError);
    expect((error as Error).message).toMatch(/nejde přečíst jako tabulku XLSX/);
  });

  it('dokument Wordu není sešit — vada souboru, ne naše', async () => {
    const docx = await buildWordDocument();
    const error = await loadXlsxWorkbook(docx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XlsxUnreadableError);
    expect(error).not.toBeInstanceOf(XlsxWorkbookError);
    expect((error as Error).message).toMatch(/není tabulka/);
  });
});

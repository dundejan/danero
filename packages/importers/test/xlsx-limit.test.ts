import { deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { assertXlsxUnpackedSize, loadXlsxWorkbook } from '../src/xlsx';

/**
 * D-4: limit 20 MB platí na KOMPRIMOVANÝ soubor, jenže XLSX je zip a
 * `workbook.xlsx.load()` rozbalí, co v archivu je (ověřeno: 1,09 MB → 320 MB
 * XML, poměr ~294:1). Velikost po rozbalení se proto musí ověřit z centrálního
 * adresáře archivu ještě před rozbalením.
 */

/**
 * Minimální zip s jednou položkou. `declaredSize` je nekomprimovaná velikost
 * zapsaná do hlaviček — přesně to jediné, co jde zjistit bez rozbalení, takže
 * přesně to musí kontrola číst.
 */
function buildZip(
  name: string,
  content: Buffer,
  declaredSize = content.length,
  poskodit = false,
): ArrayBuffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const deflated = deflateRawSync(content);
  if (poskodit) for (let i = 1; i < deflated.length; i += 1) deflated[i] = 0xff;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4); // verze
  localHeader.writeUInt16LE(8, 8); // metoda: deflate
  localHeader.writeUInt32LE(deflated.length, 18);
  localHeader.writeUInt32LE(declaredSize, 22);
  localHeader.writeUInt16LE(nameBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(nameBytes.length, 28);

  const centralOffset = localHeader.length + nameBytes.length + deflated.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  const zip = Buffer.concat([
    localHeader,
    nameBytes,
    deflated,
    central,
    nameBytes,
    eocd,
  ]);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
}

describe('ochrana proti XLSX bombě (D-4)', () => {
  it('archiv, který se rozbalí přes strop, se odmítne ještě před rozbalením', async () => {
    // 300 MB po rozbalení, zip má pár set bajtů — přesně poměr z auditu
    const bomba = buildZip('xl/worksheets/sheet1.xml', Buffer.alloc(1024, 0x20), 300 * 1024 * 1024);
    expect(bomba.byteLength).toBeLessThan(2000);
    await expect(loadXlsxWorkbook(bomba)).rejects.toThrow(/po rozbalení příliš velký/);
  });

  it('poškozený soubor skončí českou hláškou, ne anglickou TypeError', async () => {
    const nesmysl = new TextEncoder().encode('%PDF-1.7 tohle není tabulka').buffer;
    await expect(loadXlsxWorkbook(nesmysl as ArrayBuffer)).rejects.toThrow(
      /nejde přečíst jako XLSX/,
    );

    // hlavičky archivu jsou v pořádku (kontrola velikosti tedy pustí dál),
    // ale obsah je rozbitý — padá teprve exceljs a i tam musí přijít česká věta
    const rozbity = buildZip('xl/workbook.xml', Buffer.alloc(4096, 0x41), 4096, true);
    await expect(loadXlsxWorkbook(rozbity)).rejects.toThrow(/nejde přečíst jako tabulku XLSX/);
  });

  it('normální workbook projde a velikost po rozbalení sedí', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('List');
    sheet.addRow(['ID', 'Type', 'Amount']);
    sheet.addRow([1, 'BUY', 100]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const data = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;

    const rozbaleno = assertXlsxUnpackedSize(data);
    expect(rozbaleno).toBeGreaterThan(0);
    expect(rozbaleno).toBeLessThan(150 * 1024 * 1024);

    const nactene = await loadXlsxWorkbook(data);
    expect(nactene.getWorksheet('List')?.getCell('A1').value).toBe('ID');
  });
});

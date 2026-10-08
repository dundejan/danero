import { deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertXlsxUnpackedSize,
  loadXlsxWorkbook,
  XlsxTooLargeError,
  XlsxUnreadableError,
} from '../src/xlsx';

/**
 * D-4: limit 20 MB platí na KOMPRIMOVANÝ soubor, jenže XLSX je zip a
 * `workbook.xlsx.load()` rozbalí, co v archivu je (ověřeno: 1,09 MB → 320 MB
 * XML, poměr ~294:1). Velikost po rozbalení se proto musí ověřit ještě před
 * `load()`.
 *
 * L8b-01: nestačí k tomu číst velikosti z centrálního adresáře — ty si
 * archiv píše sám a JSZip rozbalí skutečný proud bez ohledu na ně. Strop
 * proto hlídá skutečně rozbalené bajty.
 */

const KB = 1024;
const MB = 1024 * KB;

interface ZipEntrySpec {
  name: string;
  content: Buffer;
  /** Nekomprimovaná velikost, kterou položka o sobě TVRDÍ (výchozí: pravdivá). */
  declaredSize?: number;
  /** Přepíše zkomprimovaný proud nesmysly — hlavičky zůstanou v pořádku. */
  corrupt?: boolean;
  /** Uřízne konec zkomprimovaného proudu (chybí závěrečný blok). */
  truncateBy?: number;
}

interface ZipOptions {
  /** Počet položek, který hlásí konec archivu (výchozí: skutečný). */
  eocdCount?: number;
  /** Bajty před začátkem archivu — offsety v hlavičkách s nimi nepočítají. */
  prefix?: Buffer;
}

/** Zip složený ručně, aby šlo v hlavičkách lhát — to knihovna nedovolí. */
function buildZip(entries: ZipEntrySpec[], options: ZipOptions = {}): ArrayBuffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    let deflated = deflateRawSync(entry.content);
    if (entry.corrupt) for (let i = 1; i < deflated.length; i += 1) deflated[i] = 0xff;
    if (entry.truncateBy) deflated = deflated.subarray(0, deflated.length - entry.truncateBy);
    const declaredSize = entry.declaredSize ?? entry.content.length;

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
    central.writeUInt32LE(offset, 42);

    locals.push(localHeader, nameBytes, deflated);
    centrals.push(central, nameBytes);
    offset += localHeader.length + nameBytes.length + deflated.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const count = options.eocdCount ?? entries.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  const zip = Buffer.concat([options.prefix ?? Buffer.alloc(0), ...locals, centralDirectory, eocd]);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
}

const CONTENT_TYPES = Buffer.from(
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ochrana proti XLSX bombě (D-4)', () => {
  it('archiv, který se rozbalí přes strop, se odmítne ještě před rozbalením', async () => {
    // 300 MB po rozbalení, zip má pár set bajtů — přesně poměr z auditu
    const bomb = buildZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        content: Buffer.alloc(1024, 0x20),
        declaredSize: 300 * MB,
      },
    ]);
    expect(bomb.byteLength).toBeLessThan(2000);
    await expect(loadXlsxWorkbook(bomb)).rejects.toThrow(/po rozbalení příliš velký/);
  });

  it('poškozený soubor skončí českou hláškou, ne anglickou TypeError', async () => {
    const garbage = new TextEncoder().encode('%PDF-1.7 tohle není tabulka').buffer;
    await expect(loadXlsxWorkbook(garbage as ArrayBuffer)).rejects.toThrow(
      /nejde přečíst jako XLSX/,
    );

    // hlavičky archivu jsou v pořádku, ale zkomprimovaný proud je rozbitý —
    // pozná to už kontrola velikosti (rozbaluje nanečisto) a řekne to česky
    const brokenStream = buildZip([
      { name: 'xl/workbook.xml', content: Buffer.alloc(4096, 0x41), corrupt: true },
    ]);
    await expect(loadXlsxWorkbook(brokenStream)).rejects.toThrow(/poškozený archiv/);

    // archiv je celý v pořádku, jen to není sešit — padá teprve exceljs
    // a i tam musí přijít česká věta
    const notWorkbook = buildZip([
      { name: '[Content_Types].xml', content: CONTENT_TYPES },
      {
        name: 'xl/workbook.xml',
        content: Buffer.from('<workbook><sheets><sheet/></sheets></workbook>'),
      },
    ]);
    await expect(loadXlsxWorkbook(notWorkbook)).rejects.toThrow(/nejde přečíst jako tabulku XLSX/);
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

    const unpacked = assertXlsxUnpackedSize(data);
    expect(unpacked).toBeGreaterThan(0);
    expect(unpacked).toBeLessThan(150 * MB);

    const loaded = await loadXlsxWorkbook(data);
    expect(loaded.getWorksheet('List')?.getCell('A1').value).toBe('ID');
  });
});

describe('strop hlídá skutečně rozbalené bajty, ne to, co archiv tvrdí (L8b-01)', () => {
  // strop je parametr, aby test nemusel vyrábět 150 MB
  const LIMIT = 1 * MB;

  it('lhoucí velikost v centrálním adresáři: odmítne se dřív, než se zavolá ExcelJS', async () => {
    // rozbalí se na 2 MB, v hlavičkách o sobě tvrdí 1000 B
    const liar = buildZip([
      { name: '[Content_Types].xml', content: CONTENT_TYPES },
      { name: 'xl/sharedStrings.xml', content: Buffer.alloc(2 * MB, 0x20), declaredSize: 1000 },
    ]);
    expect(liar.byteLength).toBeLessThan(8 * KB);

    expect(() => assertXlsxUnpackedSize(liar, LIMIT)).toThrow(XlsxTooLargeError);

    const xlsxSpy = vi.spyOn(ExcelJS.Workbook.prototype, 'xlsx', 'get');
    await expect(loadXlsxWorkbook(liar, LIMIT)).rejects.toThrow(XlsxTooLargeError);
    expect(xlsxSpy).not.toHaveBeenCalled();

    // kontrola: pod stropem se k ExcelJS dojde (a ten na lži v hlavičce spadne),
    // takže nula volání výš není jen tím, že špión nic nevidí
    await expect(loadXlsxWorkbook(liar, 4 * MB)).rejects.toThrow(XlsxUnreadableError);
    expect(xlsxSpy).toHaveBeenCalledTimes(1);
  });

  it('konec archivu hlásí 1 položku, archiv jich má víc: počítají se všechny', async () => {
    // velikosti jsou pravdivé — JSZip čte centrální adresář, dokud v něm
    // nacházejí signatury, takže druhou položku rozbalí taky
    const undercounted = buildZip(
      [
        { name: '[Content_Types].xml', content: CONTENT_TYPES },
        { name: 'xl/sharedStrings.xml', content: Buffer.alloc(2 * MB, 0x20) },
      ],
      { eocdCount: 1 },
    );

    expect(() => assertXlsxUnpackedSize(undercounted, LIMIT)).toThrow(XlsxTooLargeError);

    const xlsxSpy = vi.spyOn(ExcelJS.Workbook.prototype, 'xlsx', 'get');
    await expect(loadXlsxWorkbook(undercounted, LIMIT)).rejects.toThrow(XlsxTooLargeError);
    expect(xlsxSpy).not.toHaveBeenCalled();
  });

  it('víc položek ukazujících na velký proud se sčítá — strop platí na archiv, ne na položku', () => {
    // každá položka je pod stropem a o sobě tvrdí 1000 B, dohromady strop přelezou
    const entries = ['a', 'b', 'c'].map((name) => ({
      name: `xl/worksheets/${name}.xml`,
      content: Buffer.alloc(600 * KB, 0x20),
      declaredSize: 1000,
    }));
    expect(() => assertXlsxUnpackedSize(buildZip(entries), LIMIT)).toThrow(XlsxTooLargeError);
  });

  it('useknutý proud se počítá taky — JSZip z něj rozbalí všechno, co v něm je', () => {
    const truncated = buildZip([
      {
        name: 'xl/sharedStrings.xml',
        content: Buffer.alloc(2 * MB, 0x20),
        declaredSize: 1000,
        truncateBy: 4,
      },
    ]);
    expect(() => assertXlsxUnpackedSize(truncated, LIMIT)).toThrow(XlsxTooLargeError);
  });

  it('poctivý archiv pod stropem projde a vrátí skutečně rozbalenou velikost', () => {
    const honest = buildZip([
      { name: '[Content_Types].xml', content: CONTENT_TYPES },
      { name: 'xl/sharedStrings.xml', content: Buffer.alloc(600 * KB, 0x20) },
    ]);
    expect(assertXlsxUnpackedSize(honest, LIMIT)).toBe(CONTENT_TYPES.length + 600 * KB);
  });

  it('velikost se měří z proudu: položka, která tvrdí míň, než má, se započítá celá', () => {
    const understated = buildZip([
      { name: 'xl/sharedStrings.xml', content: Buffer.alloc(600 * KB, 0x20), declaredSize: 1000 },
    ]);
    expect(assertXlsxUnpackedSize(understated, LIMIT)).toBe(600 * KB);
  });

  it('archiv s bajty před začátkem se čte stejně jako v JSZip (offsety posunuté o předponu)', () => {
    const prefixed = buildZip(
      [{ name: 'xl/sharedStrings.xml', content: Buffer.alloc(2 * MB, 0x20), declaredSize: 1000 }],
      { prefix: Buffer.alloc(64, 0x23) },
    );
    expect(() => assertXlsxUnpackedSize(prefixed, LIMIT)).toThrow(XlsxTooLargeError);
  });

  it('nepodporovaná komprese nebo položka mimo soubor je poškozený archiv, ne pád', () => {
    const zip = Buffer.from(
      buildZip([{ name: 'xl/workbook.xml', content: Buffer.alloc(4096, 0x41) }]),
    );
    const centralOffset = zip.readUInt32LE(zip.length - 22 + 16);

    const unknownMethod = Buffer.from(zip);
    unknownMethod.writeUInt16LE(99, centralOffset + 10);
    expect(() => assertXlsxUnpackedSize(unknownMethod)).toThrow(XlsxUnreadableError);

    const outOfBounds = Buffer.from(zip);
    outOfBounds.writeUInt32LE(zip.length * 2, centralOffset + 20);
    expect(() => assertXlsxUnpackedSize(outOfBounds)).toThrow(XlsxUnreadableError);
  });
});

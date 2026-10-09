import { constants as zlibConstants, inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';

/**
 * Strop na součet NEKOMPRIMOVANÝCH velikostí položek archivu.
 *
 * Limit 20 MB na nahraný soubor platí na zip — jenže XLSX zip JE a `load()`
 * rozbalí, co v něm najde: ověřený validní soubor 1,09 MB se rozbalil na
 * 320 MB XML (poměr ~294:1), takže soubor na hraně limitu by dal ~5,9 GB
 * a sežral paměť funkce. Běžný poměr XML:zip u reálných reportů je ~10:1,
 * takže 150 MB pokryje i obří export a bombu zastaví.
 */
const MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
/** Hodnota pole, kterou zip značí „skutečná je v ZIP64 rozšíření“. */
const ZIP64_MARKER = 0xffffffff;
const ZIP64_MARKER_16 = 0xffff;
/** Komentář na konci zipu je nejvýš 64 KB, EOCD hlavička má 22 B. */
const MAX_EOCD_SEARCH = 65_535 + 22;
/** Jediné dvě metody komprese, které JSZip (a tedy ExcelJS) umí. */
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const CORRUPTED_ARCHIVE_MESSAGE =
  'Soubor nejde přečíst jako XLSX (poškozený archiv) — zkus export z platformy stáhnout znovu.';

export class XlsxTooLargeError extends Error {}
export class XlsxUnreadableError extends Error {}

/** Řádek listu: číslo řádku (pro chybové hlášky) a buňky jako text. */
export interface SheetRow {
  rowNumber: number;
  cells: string[];
}

/**
 * Text buňky nezávisle na tom, jak ji Excel uložil.
 *
 * ExcelJS vrací podle formátu číslo, `Date`, objekt formule nebo `richText` —
 * parsery brokerů si všechny stejně převádějí na string, takže to má být na
 * jednom místě. `Date` se zkracuje na ISO datum: `excelToDate` v ExcelJS je
 * ukotvený v UTC, takže `toISOString()` den neposouvá ani v UTC+2.
 */
export function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return String(cell.text ?? '').trim();
  return String(value).trim();
}

/** Neprázdné řádky listu jako text; díry ve sloupcích se vyplní prázdnem. */
export function readSheetRows(sheet: ExcelJS.Worksheet): SheetRow[] {
  const rows: SheetRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = cellText(cell);
    });
    for (let i = 0; i < cells.length; i += 1) cells[i] = cells[i] ?? '';
    if (cells.some((c) => c !== '')) rows.push({ rowNumber, cells });
  });
  return rows;
}

/** Co je v sešitu vidět na první pohled — podklad pro hlášku „nepoznáváme“. */
export interface WorkbookOutline {
  /** Názvy listů v pořadí, v jakém jsou v sešitu. */
  sheetNames: string[];
  /** První neprázdný řádek prvního listu (prázdné pole, když list nic nenese). */
  firstRow: string[];
}

/**
 * Obdoba prvního řádku CSV pro sešit: názvy listů a první řádek prvního listu.
 *
 * Sniffery XLSX se rozhodují hlavně podle názvů listů, takže bez nich se
 * z hlášky „nepoznáváme“ nedá poznat, proč soubor propadl — ani kterému
 * brokerovi patří. Vrací syrový text; ořezání a očištění od řídicích znaků
 * (`printableSample`) je na volajícím, stejně jako u CSV.
 */
export function outlineWorkbook(workbook: ExcelJS.Workbook): WorkbookOutline {
  const first = workbook.worksheets[0];
  return {
    sheetNames: workbook.worksheets.map((sheet) => sheet.name),
    firstRow: first ? (readSheetRows(first)[0]?.cells ?? []) : [],
  };
}

/**
 * Najde konec centrálního adresáře (EOCD) — od konce, kvůli komentáři.
 * Stejně jako JSZip bere POSLEDNÍ výskyt signatury v souboru.
 */
function findEocd(view: DataView): number | null {
  const from = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);
  for (let offset = view.byteLength - 4; offset >= from; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return null;
}

/** Položka archivu tak, jak ji z centrálního adresáře vyčte JSZip. */
interface ZipEntry {
  method: number;
  compressedSize: number;
  /** Nekomprimovaná velikost, kterou položka o sobě TVRDÍ — nemusí být pravda. */
  declaredSize: number;
  localHeaderOffset: number;
}

interface ZipDirectory {
  entries: ZipEntry[];
  /**
   * Posun všech offsetů v archivu: když před archivem leží cizí bajty, JSZip
   * si z rozdílu mezi skutečnou a deklarovanou polohou EOCD dopočítá „nulu“
   * a všechny offsety bere od ní.
   */
  zero: number;
}

/**
 * Přečte centrální adresář přesně tak, jak ho čte JSZip — tedy tak, jak ho
 * potom uvidí `load()`. Jakýkoli rozdíl ve čtení je díra: kontrola by měřila
 * jiné položky, než které se nakonec rozbalí.
 *
 *  - adresář začíná `velikost adresáře` před EOCD (viz `zero`), ne nutně na
 *    offsetu z EOCD;
 *  - položky se čtou, DOKUD následuje signatura — počet položek v EOCD JSZip
 *    ignoruje, takže na něj nesmíme dát ani my (L8b-01).
 */
function readCentralDirectory(view: DataView): ZipDirectory {
  if (view.byteLength < 22) {
    throw new XlsxUnreadableError('Soubor je prázdný nebo poškozený — není to platný XLSX.');
  }
  const eocd = findEocd(view);
  if (eocd === null) {
    throw new XlsxUnreadableError(
      'Soubor nejde přečíst jako XLSX (chybí konec archivu) — nejspíš se poškodil při stahování. Zkus export z platformy stáhnout znovu.',
    );
  }
  if (eocd + 22 > view.byteLength) throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);

  const records = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const sixteenBitFields = [4, 6, 8, 10].map((field) => view.getUint16(eocd + field, true));
  if (
    sixteenBitFields.includes(ZIP64_MARKER_16) ||
    directorySize === ZIP64_MARKER ||
    directoryOffset === ZIP64_MARKER
  ) {
    // ZIP64 = archiv nad 4 GB nebo přes 65 535 položek. Žádný export brokera
    // takový není a JSZip by v něm adresář hledal jinde než my. Podmínka je
    // proto stejná jako jeho: stačí marker v kterémkoli poli EOCD.
    throw new XlsxTooLargeError(
      'XLSX je příliš velký (archiv ve formátu ZIP64) — rozděl export na kratší období.',
    );
  }

  const zero = eocd - directorySize - directoryOffset;
  if (zero < 0) throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);

  const entries: ZipEntry[] = [];
  let offset = zero + directoryOffset;
  for (;;) {
    if (offset + 4 > view.byteLength) throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);
    if (view.getUint32(offset, true) !== CENTRAL_FILE_SIGNATURE) break;
    if (offset + 46 > view.byteLength) throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);

    const entry: ZipEntry = {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      declaredSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    };
    if (
      entry.compressedSize === ZIP64_MARKER ||
      entry.declaredSize === ZIP64_MARKER ||
      entry.localHeaderOffset === ZIP64_MARKER
    ) {
      // skutečnou hodnotu by si JSZip vzal ze ZIP64 rozšíření položky
      throw new XlsxTooLargeError(
        'XLSX je příliš velký (položka archivu přes 4 GB) — rozděl export na kratší období.',
      );
    }
    entries.push(entry);

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (entries.length === 0 && records !== 0) {
    throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);
  }
  return { entries, zero };
}

function tooLargeError(maxBytes: number): XlsxTooLargeError {
  return new XlsxTooLargeError(
    `XLSX je po rozbalení příliš velký (přes ${Math.round(maxBytes / 1024 / 1024)} MB) — rozděl export na kratší období.`,
  );
}

/**
 * Kolik bajtů z položky vyleze, když se rozbalí — změřeno rozbalením
 * nanečisto, se stropem `budget` na výstup (nad ním vrací `budget + 1`
 * a dál nerozbaluje). Čte tatáž pole jako JSZip:
 * komprimovanou délku a offset lokální hlavičky z centrálního adresáře,
 * z lokální hlavičky jen délku názvu a rozšíření.
 */
function measureEntry(view: DataView, zero: number, entry: ZipEntry, budget: number): number {
  const local = zero + entry.localHeaderOffset;
  if (local + 30 > view.byteLength || view.getUint32(local, true) !== LOCAL_FILE_SIGNATURE) {
    throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);
  }
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  if (start + entry.compressedSize > view.byteLength) {
    throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);
  }
  if (entry.method === METHOD_STORE) return entry.compressedSize;
  if (entry.method !== METHOD_DEFLATE) throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);

  const stream = new Uint8Array(view.buffer, view.byteOffset + start, entry.compressedSize);
  try {
    return inflateRawSync(stream, {
      // zlib chce strop aspoň 1; přetečení o ten bajt chytí součet u volajícího
      maxOutputLength: Math.max(1, budget),
      // useknutý proud (bez závěrečného bloku) není pro JSZip chyba — rozbalí
      // z něj všechno, co v něm je. Bez tohohle by zlib vyhodil a velikost
      // bychom se nedozvěděli.
      finishFlush: zlibConstants.Z_SYNC_FLUSH,
    }).length;
  } catch (error) {
    // přes strop: přesné číslo už nikoho nezajímá, volajícímu stačí „víc než zbývalo“
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') return budget + 1;
    // Rozbitý proud JSZip mlčky utne v místě chyby; kolik toho do té chvíle
    // vylezlo, se odsud zjistit nedá, takže takový archiv dál nepouštíme.
    throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);
  }
}

/**
 * Součet SKUTEČNĚ rozbalených velikostí všech položek archivu, změřený
 * PŘED `load()`. Vyhodí, když archiv nejde přečíst nebo když je součet nad
 * stropem `maxBytes`.
 *
 * Velikostem z centrálního adresáře se věřit nedá — archiv si je píše sám
 * a JSZip rozbalí skutečný proud bez ohledu na ně (L8b-01: 3,9 MB zip, který
 * o sobě tvrdil 1000 B, nafoukl proces přes 2,6 GB). Každá položka se proto
 * rozbalí nanečisto se stropem na výstup; rozbalování se přeruší ve chvíli,
 * kdy součet strop přeleze, takže kontrola sama nikdy nevyrobí víc než strop.
 * Deklarované velikosti slouží jen jako levné první síto: poctivě velký
 * soubor se odmítne, aniž by se cokoli rozbalovalo.
 *
 * Balíček běží jen na serveru, takže si smí vzít `node:zlib`.
 */
export function assertXlsxUnpackedSize(
  data: ArrayBuffer | ArrayBufferView,
  maxBytes = MAX_UNCOMPRESSED_BYTES,
): number {
  // exceljs bere i Buffer, takže ho musíme umět přečíst taky — jinak by
  // z kontroly vypadla anglická TypeError z konstruktoru DataView
  const view = ArrayBuffer.isView(data)
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : new DataView(data);
  const { entries, zero } = readCentralDirectory(view);

  let declared = 0;
  for (const entry of entries) {
    declared += entry.declaredSize;
    if (declared > maxBytes) throw tooLargeError(maxBytes);
  }

  let total = 0;
  for (const entry of entries) {
    total += measureEntry(view, zero, entry, maxBytes - total);
    if (total > maxBytes) throw tooLargeError(maxBytes);
  }
  return total;
}

/**
 * Jedno načtení XLSX pro všechny sniffy. Parsery si soubor načítají znovu
 * samy (dvojí load je vědomá cena za jednoduché signatury — soubory mají
 * limit 20 MB a upload je vzácná operace; kdyby to někdy bolelo, řešením je
 * `parse*Workbook(workbook)` varianta parserů, ne cache tady).
 *
 * Velikost po rozbalení se kontroluje PŘED `load()` — potom už je pozdě.
 */
export async function loadXlsxWorkbook(
  data: ArrayBuffer,
  maxUnpackedBytes = MAX_UNCOMPRESSED_BYTES,
): Promise<ExcelJS.Workbook> {
  assertXlsxUnpackedSize(data, maxUnpackedBytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch (error) {
    // exceljs padá na cizím obsahu anglickou TypeError („Cannot read properties
    // of undefined (reading 'col')“) — uživateli patří česká věta, ne stack.
    throw new XlsxUnreadableError(
      `Soubor nejde přečíst jako tabulku XLSX — zkontroluj, že jde o export z platformy (a ne třeba o PDF nebo poškozený soubor). Detail: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return workbook;
}

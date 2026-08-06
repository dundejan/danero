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
/** Hodnota pole, kterou zip značí „skutečná je v ZIP64 rozšíření“. */
const ZIP64_MARKER = 0xffffffff;
/** Komentář na konci zipu je nejvýš 64 KB, EOCD hlavička má 22 B. */
const MAX_EOCD_SEARCH = 65_535 + 22;

export class XlsxTooLargeError extends Error {}
export class XlsxUnreadableError extends Error {}

/** Najde konec centrálního adresáře (EOCD) — od konce, kvůli komentáři. */
function findEocd(view: DataView): number | null {
  const from = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);
  for (let offset = view.byteLength - 22; offset >= from; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return null;
}

/**
 * Součet nekomprimovaných velikostí všech položek archivu, přečtený
 * z centrálního adresáře — tedy PŘED rozbalením. Vyhodí, když archiv nejde
 * přečíst nebo když je součet nad stropem.
 */
export function assertXlsxUnpackedSize(data: ArrayBuffer | ArrayBufferView): number {
  // exceljs bere i Buffer, takže ho musíme umět přečíst taky — jinak by
  // z kontroly vypadla anglická TypeError z konstruktoru DataView
  const view = ArrayBuffer.isView(data)
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : new DataView(data);
  if (view.byteLength < 22) {
    throw new XlsxUnreadableError('Soubor je prázdný nebo poškozený — není to platný XLSX.');
  }
  const eocd = findEocd(view);
  if (eocd === null) {
    throw new XlsxUnreadableError(
      'Soubor nejde přečíst jako XLSX (chybí konec archivu) — nejspíš se poškodil při stahování. Zkus export z platformy stáhnout znovu.',
    );
  }

  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || offset === ZIP64_MARKER) {
    // ZIP64 = archiv nad 4 GB nebo přes 65 535 položek. Žádný export brokera
    // takový není a velikost bychom z 32bitových polí nespočítali poctivě.
    throw new XlsxTooLargeError(
      'XLSX je příliš velký (archiv ve formátu ZIP64) — rozděl export na kratší období.',
    );
  }

  let total = 0;
  for (let i = 0; i < entries; i += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_FILE_SIGNATURE) {
      throw new XlsxUnreadableError(
        'Soubor nejde přečíst jako XLSX (poškozený archiv) — zkus export z platformy stáhnout znovu.',
      );
    }
    const uncompressed = view.getUint32(offset + 24, true);
    if (uncompressed === ZIP64_MARKER) {
      throw new XlsxTooLargeError(
        'XLSX je příliš velký (položka archivu přes 4 GB) — rozděl export na kratší období.',
      );
    }
    total += uncompressed;
    if (total > MAX_UNCOMPRESSED_BYTES) {
      throw new XlsxTooLargeError(
        `XLSX je po rozbalení příliš velký (přes ${Math.round(MAX_UNCOMPRESSED_BYTES / 1024 / 1024)} MB) — rozděl export na kratší období.`,
      );
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
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
export async function loadXlsxWorkbook(data: ArrayBuffer): Promise<ExcelJS.Workbook> {
  assertXlsxUnpackedSize(data);
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

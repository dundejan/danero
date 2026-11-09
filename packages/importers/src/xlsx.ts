import { constants as zlibConstants, inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/**
 * Strop na součet NEKOMPRIMOVANÝCH velikostí položek archivu.
 *
 * Limit na nahraný soubor platí na zip — jenže XLSX zip JE a `load()`
 * rozbalí, co v něm najde: ověřený validní soubor 1,09 MB se rozbalil na
 * 320 MB XML (poměr ~294:1).
 *
 * Do 15. 10. 2026 tu bylo 150 MB. Bezpečnostní revize změřila, co stojí
 * paměť: ExcelJS si na 1 MB XML listu vezme zhruba 33 MB (sešit s 11 MB XML
 * → špička 428 MB, s 22 MB → 862 MB). Strop proto odpovídá limitu uploadu:
 * 4 MB zipu dává při běžném poměru ~10:1 kolem 40 MB XML, tedy ~1,3 GB
 * paměti — to legitimní export pod limitem ještě projde a funkci (2 GB na
 * Vercelu) neshodí. Hlavní úspora je jinde: import sešit načte jen jednou
 * (`XlsxSource`), dřív ho držel dvakrát a týž soubor vzal přes 1,6 GB.
 */
const MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;

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
/**
 * Archiv je v pořádku a sešit v něm je, ale nepřečteme ho my (exceljs).
 * Na rozdíl od poškozeného souboru je to vada na naší straně, takže si import
 * soubor schová k rozboru (`failed_imports`).
 */
export class XlsxWorkbookError extends XlsxUnreadableError {}

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
 * Jedno načtení XLSX pro všechny sniffy — a import ho pak předá i parseru
 * (`XlsxSource`), takže se sešit v paměti nedrží dvakrát.
 *
 * Velikost po rozbalení se kontroluje PŘED `load()` — potom už je pozdě.
 */
export async function loadXlsxWorkbook(
  data: ArrayBuffer | Buffer,
  maxUnpackedBytes = MAX_UNCOMPRESSED_BYTES,
): Promise<ExcelJS.Workbook> {
  assertXlsxUnpackedSize(data, maxUnpackedBytes);
  let zip: JSZip;
  try {
    // jen centrální adresář — položky se rozbalují až na vyžádání
    zip = await JSZip.loadAsync(data);
    if (!(await isSpreadsheetPackage(zip))) throw new XlsxUnreadableError(NOT_SPREADSHEET_MESSAGE);
  } catch (error) {
    if (error instanceof XlsxUnreadableError) throw error;
    throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);
  }
  try {
    return await loadWithExcelJs(data);
  } catch (firstError) {
    // Teprve tady, na cestě selhání, se archiv rozbaluje celý. Běžný sešit
    // tak nic navíc nestojí a o tom, čí je vada, rozhoduje celistvost:
    // poškozené stahování („uncompressed data size mismatch“, CRC) je vada
    // souboru, ne naše — takový soubor se neschovává.
    try {
      await JSZip.loadAsync(data, { checkCRC32: true });
    } catch {
      throw new XlsxUnreadableError(CORRUPTED_ARCHIVE_MESSAGE);
    }
    const rewritten = await withoutNamespacePrefixes(zip).catch(() => null);
    if (rewritten === null) throw workbookError(firstError);
    try {
      return await loadWithExcelJs(rewritten);
    } catch (error) {
      throw workbookError(error);
    }
  }
}

const NOT_SPREADSHEET_MESSAGE =
  'Soubor není tabulka — v archivu chybí sešit (je to třeba dokument Wordu nebo PowerPointu). Nahraj export transakcí z platformy.';

/**
 * Je v balíčku OOXML sešit? Začátek `[Content_Types].xml`, podle kterého
 * `sniffFileFormat` pozná XLSX, mají i dokumenty Wordu a PowerPointu — a ty
 * nesmí skončit jako „sešit, který neumíme“ (naše vada, schovává se).
 * Části sešitu leží v `xl/`; jinde jen tehdy, když to `[Content_Types].xml`
 * hlásí typem obsahu SpreadsheetML.
 */
async function isSpreadsheetPackage(zip: JSZip): Promise<boolean> {
  if (zip.file(/^xl\//).length > 0) return true;
  const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  return contentTypes?.includes('spreadsheetml') ?? false;
}

async function loadWithExcelJs(data: ArrayBuffer | Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // JSZip pod exceljs bere ArrayBuffer i Buffer; typy exceljs znají jen jeden
  await workbook.xlsx.load(data as ArrayBuffer);
  return workbook;
}

/**
 * Archiv je v pořádku a sešit v něm je, jen ho exceljs nepřečte — vada na
 * naší straně. Anglická TypeError („Cannot read properties of undefined
 * (reading 'sheets')“) jde jen do detailu.
 */
const workbookError = (error: unknown): XlsxWorkbookError =>
  new XlsxWorkbookError(
    `Soubor nejde přečíst jako tabulku XLSX — sešit je uložený způsobem, který zatím neumíme. Detail: ${error instanceof Error ? error.message : String(error)}`,
  );

/**
 * Jmenné prostory, ve kterých exceljs poznává prvky jen podle JMÉNA BEZ
 * PREFIXU: hlavní SpreadsheetML (sešit, listy, styly, sdílené texty),
 * vztahy balíčku a typy obsahu.
 */
const UNPREFIXED_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://schemas.openxmlformats.org/package/2006/relationships',
  'http://schemas.openxmlformats.org/package/2006/content-types',
]);
/** Atributy z tohohle jmenného prostoru čte exceljs jen jako `r:id`. */
const OFFICE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * `xmlns:p="…"` i `xmlns:p='…'` — XML dovoluje oboje. Délka hodnoty je
 * omezená: neuzavřená uvozovka by jinak každé hledání protáhla až na konec
 * části a tisíce takových deklarací by z jednoho průchodu udělaly kvadratický.
 */
const NAMESPACE_DECLARATION = /\sxmlns:([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]{0,512})"|'([^']{0,512})')/g;
const PREFIXED_ELEMENT = /<(\/?)([A-Za-z_][\w.-]*):/g;
const PREFIXED_ATTRIBUTE = /(\s)([A-Za-z_][\w.-]*):([\w.-]+\s*=)/g;

/**
 * Část sešitu přepsaná do tvaru, který exceljs přečte: prvky ze jmenných
 * prostorů `UNPREFIXED_NAMESPACES` bez prefixu (`<x:sheet>` → `<sheet>`)
 * a atributy vztahů s prefixem `r`. `null`, když se nic měnit nemusí.
 *
 * Prefix je podle specifikace XML rovnocenný výchozímu jmennému prostoru
 * a používají ho generátory nad .NET OpenXML SDK. exceljs ale porovnává jen
 * jména prvků, takže na `<x:workbook>` spadl s „Cannot read properties of
 * undefined (reading 'sheets')“ (9. 11. 2026, výpis z eToro). Deklarace
 * `xmlns:x` se nechávají, jak jsou — exceljs jmenné prostory nevyhodnocuje.
 *
 * Každý přepis je JEDEN průchod, ať je deklarací kolik chce: prefix se
 * hledá v množině, ne regulárním výrazem na prefix (bezpečnostní revize
 * 9. 11. 2026 — 40 MB list s tisíci deklarací by jinak pálil čas funkce).
 *
 * Rozsah deklarací se nesleduje (prefix platí v celé části): přebindovat
 * týž prefix uvnitř dokumentu na jiný jmenný prostor žádný známý generátor
 * sešitů nedělá, a kdyby ano, skončí to jako dnes — sešit, který neumíme.
 */
export function stripNamespacePrefixes(xml: string): string | null {
  const elementPrefixes = new Set<string>();
  const relationshipPrefixes = new Set<string>();
  // prefix `r` obsazený jiným jmenným prostorem: přejmenování by atributy smíchalo
  let rTaken = false;
  for (const match of xml.matchAll(NAMESPACE_DECLARATION)) {
    const prefix = match[1]!;
    const uri = match[2] ?? match[3] ?? '';
    if (UNPREFIXED_NAMESPACES.has(uri)) elementPrefixes.add(prefix);
    else if (uri === OFFICE_RELATIONSHIPS_NAMESPACE) relationshipPrefixes.add(prefix);
    else if (prefix === 'r') rTaken = true;
  }
  relationshipPrefixes.delete('r');
  if (rTaken) relationshipPrefixes.clear();
  if (elementPrefixes.size === 0 && relationshipPrefixes.size === 0) return null;

  let out = xml;
  if (elementPrefixes.size > 0) {
    out = out.replace(PREFIXED_ELEMENT, (whole, slash: string, prefix: string) =>
      elementPrefixes.has(prefix) ? `<${slash}` : whole,
    );
  }
  if (relationshipPrefixes.size > 0) {
    out = out.replace(PREFIXED_ATTRIBUTE, (whole, space: string, prefix: string, rest: string) =>
      relationshipPrefixes.has(prefix) ? `${space}r:${rest}` : whole,
    );
  }
  return out === xml ? null : out;
}

/**
 * Sešit s prefixy jmenných prostorů přebalený do tvaru pro exceljs; `null`,
 * když žádná část prefixy nemá (pak přepis nepomůže). Volá se jen po selhání
 * `load()`, archiv je v tu chvíli ověřený a rozbalený nejvýš na
 * `MAX_UNCOMPRESSED_BYTES`. Ukládá se bez komprese — exceljs ho stejně hned
 * rozbalí, a komprese by jen pálila čas funkce.
 */
async function withoutNamespacePrefixes(zip: JSZip): Promise<Buffer | null> {
  let changed = false;
  for (const part of zip.file(/\.(?:xml|rels)$/i)) {
    const rewritten = stripNamespacePrefixes(await part.async('string'));
    if (rewritten === null) continue;
    zip.file(part.name, rewritten);
    changed = true;
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }) : null;
}

/**
 * Vstup parseru sešitu: bajty souboru, nebo sešit, který už načetl import
 * kvůli sniffům. Druhé načtení téhož souboru by paměť zdvojnásobilo
 * (bezpečnostní revize 15. 10. 2026: 4 MB soubor 1,0 → 1,6 GB).
 */
export type XlsxSource = ArrayBuffer | Buffer | ExcelJS.Workbook;

/** Je zdroj už načtený sešit? Podle bajtů, ne `instanceof` — dvě kopie exceljs by ho rozbily. */
export function isLoadedWorkbook(data: XlsxSource): data is ExcelJS.Workbook {
  return !(data instanceof ArrayBuffer) && !Buffer.isBuffer(data);
}

/**
 * Sešit pro parser: načtený se použije, jak je, bajty se načtou přes
 * `loadXlsxWorkbook` (stejná kontrola velikosti i hlášky jako při importu —
 * parser se dá volat i samostatně). Chybu vrací jako text, který parser
 * zapíše do výsledku, místo aby vyhodil.
 */
export async function openXlsxSource(
  data: XlsxSource,
): Promise<{ workbook: ExcelJS.Workbook } | { error: string }> {
  if (isLoadedWorkbook(data)) return { workbook: data };
  try {
    return { workbook: await loadXlsxWorkbook(data) };
  } catch (error) {
    if (error instanceof XlsxTooLargeError || error instanceof XlsxUnreadableError) {
      return { error: error.message };
    }
    throw error;
  }
}

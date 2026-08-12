import ExcelJS from 'exceljs';
import { emptyResult, type ImportResult, type IsinInstrumentMap } from '../types';
import { loadXlsxWorkbook, readSheetRows, type SheetRow } from '../xlsx';
import { parseRevolutCryptoTable, REVOLUT_CRYPTO_COLUMNS } from './crypto';
import { parseRevolutInvestTable, REVOLUT_INVEST_SNIFF_COLUMNS } from './invest';
import { REVOLUT_BROKER } from './common';

/**
 * Revolut „Account statement“ jako XLSX.
 *
 * V aplikaci se u výpisu volí formát „Excel“ a podle účtu z něj chodí jednou
 * CSV a jindy opravdový sešit — návod přitom míří na tutéž volbu. Do 12. 8. 2026
 * uměl Danero jen CSV, takže polovina uživatelů dostala „XLSX nepoznáváme —
 * podporujeme reporty XTB, eToro, Saxo a MetaTrader 5“ nad souborem, ke kterému
 * je navigoval náš vlastní návod.
 *
 * Tabulka je v obou formátech stejná, takže se sešit jen přečte na
 * `(headers, rows)` a pošle do téhož jádra jako CSV.
 */

type RevolutSheetKind = 'invest' | 'crypto';

/** Podle hlavičky pozná, jestli jde o akciový, nebo krypto výpis. */
function kindOf(headers: string[]): RevolutSheetKind | null {
  const cells = headers.map((cell) => cell.trim());
  if (REVOLUT_INVEST_SNIFF_COLUMNS.every((name) => cells.includes(name))) return 'invest';
  if (REVOLUT_CRYPTO_COLUMNS.every((name) => cells.includes(name))) return 'crypto';
  return null;
}

/** Kolik řádků nad hlavičkou snese preambule sešitu (účet, období, měna…). */
const MAX_PREAMBLE_ROWS = 20;

interface RevolutTable {
  kind: RevolutSheetKind;
  headers: string[];
  rows: string[][];
}

/**
 * Najde list a v něm HLAVIČKOVÝ řádek — ne nutně první.
 *
 * Sešit z Revolutu běžně otevírá blok s číslem účtu a obdobím, takže brát
 * první řádek jako hlavičku by uživatele vrátilo přesně k hlášce „XLSX
 * nepoznáváme“, kvůli které tenhle soubor vznikl. Hledá se stejně jako
 * preambule u Coinbase: prvních pár řádků, dokud nesedí sada sloupců.
 */
function findTable(workbook: ExcelJS.Workbook): RevolutTable | null {
  for (const sheet of workbook.worksheets) {
    const rows: SheetRow[] = readSheetRows(sheet);
    const headerIndex = rows
      .slice(0, MAX_PREAMBLE_ROWS)
      .findIndex((row) => kindOf(row.cells) !== null);
    if (headerIndex === -1) continue;
    const headers = rows[headerIndex]!.cells.map((cell) => cell.trim());
    return {
      kind: kindOf(headers)!,
      headers,
      rows: rows.slice(headerIndex + 1).map((row) => row.cells),
    };
  }
  return null;
}

export function sniffRevolutXlsx(workbook: ExcelJS.Workbook): boolean {
  return findTable(workbook) !== null;
}

export async function parseRevolutXlsx(
  data: ArrayBuffer | Buffer,
  instrumentMap: IsinInstrumentMap = {},
): Promise<ImportResult & { unmappedSymbols: string[] }> {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const workbook = await loadXlsxWorkbook(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
  const table = findTable(workbook);
  if (table !== null) {
    if (table.kind === 'invest') {
      return parseRevolutInvestTable(table.headers, table.rows, instrumentMap);
    }
    return { ...parseRevolutCryptoTable(table.headers, table.rows), unmappedSymbols: [] };
  }

  const empty = { ...emptyResult(REVOLUT_BROKER), unmappedSymbols: [] as string[] };
  // úplně prázdný sešit = prázdné období, ne chyba formátu (konzistentně s T212)
  const prvniRadky = workbook.worksheets.flatMap((sheet) => readSheetRows(sheet));
  if (prvniRadky.length === 0) return empty;

  const nalezene = prvniRadky[0]!.cells.filter((cell) => cell.trim() !== '').join(', ');
  empty.errors.push({
    line: prvniRadky[0]!.rowNumber,
    message: `Sešit nevypadá jako výpis Revolutu — nenašli jsme ani akciové sloupce (${REVOLUT_INVEST_SNIFF_COLUMNS.join(', ')}), ani krypto (${REVOLUT_CRYPTO_COLUMNS.join(', ')}). V prvním řádku jsme našli: ${nalezene}`,
  });
  return empty;
}

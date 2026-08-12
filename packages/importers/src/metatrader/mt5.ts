import ExcelJS from 'exceljs';
import { Decimal, ZERO } from '@danero/shared';
import { normalizeHeader } from '../csv';
import { emptyResult, type ImportResult } from '../types';
import {
  extractHtmlRows,
  findAccountCurrency,
  makePush,
  mtDateToIso,
  parseMtNumber,
  parseMtNumberOrZero,
  syntheticDerivativePair,
} from './common';

export const MT5_BROKER = 'mt5';

/**
 * Parser MT5 reportu — HTML („ReportHistory-<účet>.html“) i XLSX „Open XML“
 * export z terminálu (Historie → pravé tlačítko → Report / Export).
 *
 * Zpracovává sekci **Deals** (atomické obchody vč. balance operací); sekce
 * Orders/Positions/Working Orders se přeskakují. Report neuvádí hodnoty
 * podkladu, jen výsledek v měně účtu — každý uzavírací deal (Direction out /
 * in/out) se modeluje jako syntetický derivátový pár dle R-12/R-12m
 * (viz syntheticDerivativePair): net = Profit + Swap + Commission (+ Fee).
 * Komise/poplatky otevíracích (in) dealů se přičítají k prvnímu uzavíracímu
 * dealu téhož symbolu. Sloupce se mapují VÝHRADNĚ podle názvů hlaviček —
 * sada se mezi brokery a buildy liší (Fee mají jen novější buildy).
 */

/** Sloupce tabulky Deals — mapování podle názvů (normalizeHeader). */
const HEADER_SYNONYMS = {
  time: ['time'],
  deal: ['deal'],
  symbol: ['symbol'],
  type: ['type'],
  direction: ['direction'],
  commission: ['commission'],
  fee: ['fee'],
  swap: ['swap'],
  profit: ['profit'],
  comment: ['comment'],
} as const;

type Field = keyof typeof HEADER_SYNONYMS;
type ColumnMap = Partial<Record<Field, number>>;

const REQUIRED_FIELDS: readonly Field[] = [
  'time',
  'deal',
  'symbol',
  'type',
  'direction',
  'commission',
  'swap',
  'profit',
];

/** Řádek reportu: skutečné číslo řádku (HTML) / řádek listu (XLSX) + buňky. */
interface Mt5Row {
  line: number;
  cells: string[];
}

function mapColumns(normalizedCells: string[]): ColumnMap {
  const columns: ColumnMap = {};
  normalizedCells.forEach((cell, i) => {
    for (const field of Object.keys(HEADER_SYNONYMS) as Field[]) {
      if (columns[field] === undefined && (HEADER_SYNONYMS[field] as readonly string[]).includes(cell)) {
        columns[field] = i;
      }
    }
  });
  return columns;
}

/** Nadpis sekce Deals: řádek s jedinou neprázdnou buňkou „Deals“. */
const isDealsMarker = (row: Mt5Row): boolean => {
  const nonEmpty = row.cells.filter((cell) => cell.trim() !== '');
  return nonEmpty.length === 1 && nonEmpty[0]!.trim().toLowerCase() === 'deals';
};

/**
 * Jádro parseru nad řádky (společné pro HTML i XLSX): najde sekci Deals,
 * hlavičku podle názvů sloupců, měnu účtu z hlavičky reportu a zpracuje dealy.
 */
function parseMt5Rows(rows: Mt5Row[], result: ImportResult): ImportResult {
  // prázdný report = prázdné období, ne chyba formátu
  if (rows.length === 0) return result;

  const dealsIndex = rows.findIndex(isDealsMarker);
  if (dealsIndex < 0) {
    result.errors.push({
      line: 1,
      message:
        'V reportu chybí sekce „Deals“ — nahraj kompletní MT5 report (v terminálu: záložka Historie → pravé tlačítko → Report → HTML nebo Open XML).',
    });
    return result;
  }

  let headerIndex = -1;
  let columns: ColumnMap = {};
  for (let i = dealsIndex + 1; i < rows.length && i <= dealsIndex + 5; i += 1) {
    const normalized = rows[i]!.cells.map(normalizeHeader);
    if (normalized.includes('time') && normalized.includes('direction')) {
      columns = mapColumns(normalized);
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) {
    result.errors.push({
      line: rows[dealsIndex]!.line,
      message:
        'Pod sekcí „Deals“ chybí hlavička tabulky (sloupce „Time“ a „Direction“) — tuhle variantu MT5 reportu neznáme, nahlaš nám ji.',
    });
    return result;
  }
  const missing = REQUIRED_FIELDS.filter((field) => columns[field] === undefined);
  if (missing.length > 0) {
    result.errors.push({
      line: rows[headerIndex]!.line,
      message: `V hlavičce tabulky Deals chybí sloupce: ${missing.join(', ')} — bez nich nejde report zpracovat.`,
    });
    return result;
  }

  const currency = findAccountCurrency(rows.slice(0, dealsIndex));
  if (!currency) {
    result.errors.push({
      line: 1,
      message:
        'V hlavičce reportu chybí měna účtu („Currency: …“) — bez ní neumíme výsledky obchodů zpracovat. Vygeneruj report znovu z MT5 terminálu.',
    });
    return result;
  }

  const push = makePush(result);
  const cellOf = (row: Mt5Row, field: Field): string => {
    const col = columns[field];
    return col === undefined ? '' : (row.cells[col] ?? '').trim();
  };

  /**
   * Komise/poplatky otevíracích (in) dealů čekající na první uzavírací (out)
   * deal. Tabulka Deals nemá sloupec pozice — nejbližší spolehlivý klíč je
   * symbol: součet nákladů je tak vždy započtený správně, jen u souběžných
   * pozic téhož symbolu se může náklad přiřadit sousednímu obchodu.
   */
  const pendingCosts = new Map<string, { line: number; total: Decimal }>();

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const raw = row.cells.join(' | ');
    const timeRaw = cellOf(row, 'time');
    const dealNo = cellOf(row, 'deal');
    const date = mtDateToIso(timeRaw);
    const hasDealNumber = /^\d+$/.test(dealNo);
    // souhrnné řádky pod tabulkou (bez času i čísla dealu) = konec sekce Deals
    if (date === null && !hasDealNumber) break;
    if (date === null) {
      result.errors.push({
        line: row.line,
        message: `Deal ${dealNo}: neplatný čas „${timeRaw}“ — očekáváme YYYY.MM.DD HH:MM:SS.`,
        raw,
      });
      continue;
    }
    if (!hasDealNumber) {
      result.errors.push({
        line: row.line,
        message: `Řádek nemá číslo dealu (sloupec Deal obsahuje „${dealNo}“) — nejde zpracovat.`,
        raw,
      });
      continue;
    }

    const type = cellOf(row, 'type').toLowerCase();
    const symbol = cellOf(row, 'symbol').toUpperCase();
    const comment = cellOf(row, 'comment');

    if (type === 'balance' || type === 'credit') {
      const amount = cellOf(row, 'profit');
      result.skipped.push({
        line: row.line,
        message: `Vklad/výběr (${type})${comment !== '' ? ` „${comment}“` : ''}: ${amount} ${currency} — peněžní pohyby se nedaní a do importu nevstupují.`,
        raw,
      });
      continue;
    }
    if (type !== 'buy' && type !== 'sell') {
      result.errors.push({
        line: row.line,
        message: `Neznámý typ dealu „${cellOf(row, 'type')}“ — nahlaš nám ho, doplníme podporu.`,
        raw,
      });
      continue;
    }

    const commission = parseMtNumberOrZero(cellOf(row, 'commission'));
    const swap = parseMtNumberOrZero(cellOf(row, 'swap'));
    // Profit je výsledek dealu, ne volitelný sloupec (viz MT4)
    const profit = parseMtNumber(cellOf(row, 'profit'));
    const fee = columns.fee === undefined ? ZERO : parseMtNumberOrZero(cellOf(row, 'fee'));
    if (commission === null || swap === null || profit === null || fee === null) {
      result.errors.push({
        line: row.line,
        message: `Deal ${dealNo}: nečitelné číslo ve sloupcích Commission/Fee/Swap/Profit.`,
        raw,
      });
      continue;
    }
    if (symbol === '') {
      result.errors.push({
        line: row.line,
        message: `Deal ${dealNo}: obchodní deal bez symbolu instrumentu — nejde zpracovat.`,
        raw,
      });
      continue;
    }

    const direction = cellOf(row, 'direction').toLowerCase().replace(/\s+/g, '');
    if (direction === 'in') {
      // otevření pozice se nedaní; komise/poplatek ale patří do nákladů
      // obchodu — připíše se k prvnímu uzavíracímu dealu téhož symbolu
      const cost = commission.plus(fee);
      if (!cost.eq(0)) {
        const pending = pendingCosts.get(symbol);
        pendingCosts.set(symbol, {
          line: pending?.line ?? row.line,
          total: (pending?.total ?? ZERO).plus(cost),
        });
      }
      continue;
    }
    if (direction !== 'out' && direction !== 'in/out') {
      result.errors.push({
        line: row.line,
        message: `Deal ${dealNo}: neznámý směr „${cellOf(row, 'direction')}“ (očekáváme in, out nebo in/out) — nahlaš nám ho.`,
        raw,
      });
      continue;
    }

    // uzavírací deal: čistý výsledek = profit + swap + komise (+ poplatek)
    // tohoto řádku + náklady otevíracích dealů téhož symbolu (vše se znaménky)
    const openCosts = pendingCosts.get(symbol)?.total ?? ZERO;
    pendingCosts.delete(symbol);
    const net = profit.plus(swap).plus(commission).plus(fee).plus(openCosts);
    const feePart = columns.fee === undefined ? '' : ` + poplatek ${fee.toString()}`;
    const costPart = openCosts.eq(0) ? '' : ` + komise otevíracích dealů ${openCosts.toString()}`;
    const note = `MT5 ${symbol}, deal ${dealNo}${comment !== '' ? ` („${comment}“)` : ''}: čistý výsledek ${net.toString()} ${currency} (profit ${profit.toString()} + swap ${swap.toString()} + komise ${commission.toString()}${feePart}${costPart}).`;
    const [buyLeg, sellLeg] = syntheticDerivativePair({
      idBase: `mt5-${dealNo}`,
      isin: `MT5:${dealNo}`,
      symbol,
      // report u dealu čas otevření pozice neuvádí → obě nohy nesou čas uzavření
      openDate: date,
      closeDate: date,
      net,
      currency,
      note,
      openNote:
        'Čas otevření pozice report u dealu neuvádí — použit čas uzavření (u derivátů s maržovým vypořádáním časový test nehraje roli).',
    });
    push(row.line, raw, buyLeg);
    push(row.line, raw, sellLeg);
  }

  for (const [symbol, pending] of pendingCosts) {
    result.warnings.push({
      line: pending.line,
      message: `Komise ${pending.total.abs().toString()} ${currency} z otevíracích dealů ${symbol} nemá v reportu uzavírací deal (pozice je zřejmě stále otevřená) — do výsledku nevstoupila; po uzavření pozice nahraj report za celé období a započte se.`,
    });
  }

  return result;
}

/* ── HTML ────────────────────────────────────────────────────────────────── */

/** Autodetekce MT5 HTML reportu: sekce „Deals“ + sloupec „Direction“ (MT4 nemá ani jedno). */
export function sniffMt5Html(text: string): boolean {
  return />\s*Deals\s*</i.test(text) && />\s*Direction\s*</i.test(text);
}

export function parseMt5Html(text: string): ImportResult {
  const result = emptyResult(MT5_BROKER);
  if (text.trim() === '') return result;

  const rows = extractHtmlRows(text);
  if (rows.length === 0) {
    result.errors.push({
      line: 1,
      message:
        'Soubor neobsahuje žádnou tabulku — nevypadá jako MT5 report (v terminálu: záložka Historie → pravé tlačítko → Report).',
    });
    return result;
  }
  return parseMt5Rows(rows, result);
}

/* ── XLSX (Open XML) ─────────────────────────────────────────────────────── */

/** Buňka jako string — čísla přes String(value), datumy ISO, formule/richtext přes cell.text. */
function xlsxCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
  if (typeof value === 'object') return String(cell.text ?? '').trim();
  return String(value).trim();
}

/** Načte list do řádků; úplně prázdné řádky vynechá, čísla řádků zachová. */
function readSheetRows(sheet: ExcelJS.Worksheet): Mt5Row[] {
  const rows: Mt5Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = xlsxCellText(cell);
    });
    for (let i = 0; i < cells.length; i += 1) cells[i] = cells[i] ?? '';
    if (cells.some((cell) => cell !== '')) rows.push({ line: rowNumber, cells });
  });
  return rows;
}

/** Autodetekce MT5 XLSX: některý list má buňku „Deals“ a hlavičku s „Direction“. */
export function sniffMt5Xlsx(workbook: ExcelJS.Workbook): boolean {
  return workbook.worksheets.some((sheet) => {
    const rows = readSheetRows(sheet);
    return (
      rows.some((row) => row.cells.some((cell) => cell.trim().toLowerCase() === 'deals')) &&
      rows.some((row) => row.cells.map(normalizeHeader).includes('direction'))
    );
  });
}

export async function parseMt5Xlsx(data: ArrayBuffer | Buffer): Promise<ImportResult> {
  const result = emptyResult(MT5_BROKER);

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (error) {
    result.errors.push({
      line: 1,
      message: `Soubor se nepodařilo přečíst jako XLSX: ${error instanceof Error ? error.message : String(error)}`,
    });
    return result;
  }

  // list s tabulkou Deals (reporty mívají jediný list, ale nespoléháme na to)
  const sheet =
    workbook.worksheets.find((candidate) =>
      readSheetRows(candidate).some(isDealsMarker),
    ) ?? workbook.worksheets[0];
  if (!sheet) return result; // workbook bez listů = prázdný soubor

  return parseMt5Rows(readSheetRows(sheet), result);
}

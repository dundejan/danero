import ExcelJS from 'exceljs';
import { Decimal, d, TransactionSchema } from '@danero/shared';
import { cleanNumber, isValidIsoDate, normalizeHeader, stripDiacritics } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const XTB_BROKER = 'xtb';

/**
 * XTB export neobsahuje měnu instrumentu ani ISIN (docs/03) — dodává je mapování
 * symbolů. BUY/SELL bez mapování se neimportuje a symbol skončí v `unmappedSymbols`;
 * dividendy mapování nepotřebují (jsou v měně účtu, ISIN je u nich optional).
 */
export interface XtbInstrumentMap {
  /**
   * Měna je volitelná: dividendám XTB stačí ISIN (jsou v měně účtu), obchod bez
   * měny instrumentu ale spočítat nejde — takový symbol se hlásí k doplnění.
   */
  [symbol: string]: { isin: string; currency?: string };
}

/**
 * Fallback měny účtu, když ji report neuvádí — EXPLICITNĚ EUR (nejčastější měna
 * XTB účtů českých klientů po přechodu na EUR onboarding); použití vždy doprovází warning.
 */
const DEFAULT_ACCOUNT_CURRENCY = 'EUR';

/** Názvy listu s peněžními operacemi (EN/CZ), porovnává se bez diakritiky. */
const CASH_SHEET_NAMES = ['CASH OPERATION HISTORY', 'HISTORIE PENEZNICH OPERACI'];

/** Sloupce tabulky — synonyma EN/CZ hlaviček (bez diakritiky, lowercase). */
const HEADER_SYNONYMS = {
  id: ['id'],
  type: ['type', 'typ'],
  time: ['time', 'cas'],
  comment: ['comment', 'komentar'],
  symbol: ['symbol'],
  amount: ['amount', 'castka'],
} as const;

type Field = keyof typeof HEADER_SYNONYMS;
type ColumnMap = Partial<Record<Field, number>>;

type OperationKind =
  | 'BUY'
  | 'SELL'
  | 'DIVIDEND'
  | 'WITHHOLDING'
  | 'INTEREST'
  | 'INTEREST_TAX'
  | 'FEE'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'UNKNOWN';

/** Řádek listu: skutečné číslo řádku v Excelu (uživatel ho tam vidí) + buňky jako stringy. */
interface SheetRow {
  rowNumber: number;
  cells: string[];
}


/** Buňka jako string — čísla přes String(value), datumy ISO, formule/richtext přes cell.text. */
function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
  if (typeof value === 'object') return String(cell.text ?? '').trim();
  return String(value).trim();
}

/** Načte list do matice stringů; úplně prázdné řádky vynechá. */
function readSheetRows(sheet: ExcelJS.Worksheet): SheetRow[] {
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

function findCashSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | undefined {
  return workbook.worksheets.find((sheet) =>
    CASH_SHEET_NAMES.includes(stripDiacritics(sheet.name).replace(/\s+/g, ' ').trim().toUpperCase()),
  );
}

/** Autodetekce: XTB report se pozná podle listu peněžních operací (EN/CZ). */
export function sniffXtbXlsx(workbook: ExcelJS.Workbook): boolean {
  return findCashSheet(workbook) !== undefined;
}

/**
 * Hlavičkový řádek se hledá obsahem (buňky „ID“ + „Type/Typ“) — v reálných
 * reportech tabulka začíná až pod metadaty reportu, ne na pevné pozici.
 */
function findHeader(rows: SheetRow[]): { index: number; columns: ColumnMap } | null {
  for (let i = 0; i < rows.length; i += 1) {
    const normalized = rows[i]!.cells.map(normalizeHeader);
    if (!normalized.includes('id')) continue;
    if (!normalized.includes('type') && !normalized.includes('typ')) continue;
    const columns: ColumnMap = {};
    normalized.forEach((cell, col) => {
      for (const field of Object.keys(HEADER_SYNONYMS) as Field[]) {
        if (columns[field] === undefined && (HEADER_SYNONYMS[field] as readonly string[]).includes(cell)) {
          columns[field] = col;
        }
      }
    });
    return { index: i, columns };
  }
  return null;
}

/** Měna účtu z metadat nad tabulkou („Account currency“ / „Měna účtu“). */
function detectAccountCurrency(preambleRows: SheetRow[]): string | null {
  for (const row of preambleRows) {
    for (let i = 0; i < row.cells.length; i += 1) {
      const cell = row.cells[i]!;
      if (!/account currency|mena uctu/i.test(stripDiacritics(cell))) continue;
      // měna bývá za dvojtečkou v téže buňce, nebo v některé další buňce řádku
      const inline = /\b([A-Z]{3})\s*$/.exec(cell);
      if (inline) return inline[1]!;
      for (let j = i + 1; j < row.cells.length; j += 1) {
        if (/^[A-Z]{3}$/.test(row.cells[j]!)) return row.cells[j]!;
      }
    }
  }
  return null;
}

/** „02.01.2025 14:30:15“ (DD.MM.YYYY) i ISO → 'YYYY-MM-DD'; neexistující den → null. */
function toIsoDate(value: string): string | null {
  const czech = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(value);
  const iso = czech ? `${czech[3]}-${czech[2]}-${czech[1]}` : /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1];
  return iso !== undefined && isValidIsoDate(iso) ? iso : null;
}

/** Klasifikace operace podle Type (EN/CZ synonyma, case-insensitive, bez diakritiky). */
function classifyOperation(type: string, comment: string): OperationKind {
  const t = stripDiacritics(type).toLowerCase();
  if (t.includes('stocks/etf purchase') || t.includes('nakup akcii/etf')) return 'BUY';
  if (t.includes('stocks/etf sale') || t.includes('prodej akcii/etf')) return 'SELL';
  if (t.includes('withholding tax') || t.includes('srazkova dan')) return 'WITHHOLDING';
  // „Free funds interest tax“ nutně před obecným úrokem
  if ((t.includes('free funds interest') && t.includes('tax')) || t.includes('dan z uroku')) {
    return 'INTEREST_TAX';
  }
  if (t.includes('free funds interest') || t.includes('uroky z volnych prostredku')) {
    return 'INTEREST';
  }
  if (t.includes('dividend')) return 'DIVIDEND'; // pokrývá i CZ „Dividenda“
  const c = stripDiacritics(comment).toLowerCase();
  if (t.includes('commission') || t.includes('provize') || c.includes('commission') || c.includes('provize')) {
    return 'FEE';
  }
  if (t.includes('withdrawal') || t.includes('vyber')) return 'WITHDRAWAL';
  if (t.includes('deposit') || t.includes('vklad')) return 'DEPOSIT';
  return 'UNKNOWN';
}

/**
 * Kusy a cena z komentáře obchodu: „OPEN BUY 5 @ 458.65“,
 * „CLOSE BUY 5/10 @ 460.00“ (X/Y = zavřeno X z Y kusů → quantity je X).
 * Směr transakce určuje sloupec Type — BUY/SELL v komentáři nese směr POZICE.
 */
const TRADE_COMMENT_RE = /(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+([\d.,]+)(?:\/[\d.,]+)?\s*@\s*([\d.,]+)/i;

function parseTradeComment(comment: string): { quantity: string; price: string } | null {
  const match = TRADE_COMMENT_RE.exec(comment);
  if (!match) return null;
  return { quantity: match[1]!, price: match[2]! };
}

/** Číslo jako Decimal; toleruje tisícové čárky (cleanNumber) i desetinnou čárku. */
function parseAmount(raw: string): Decimal | null {
  const cleaned = cleanNumber(raw);
  const normalized = /^-?\d+,\d+$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return d(normalized);
}

/**
 * Parser XTB xStation „Full report“ XLSX (docs/03). Zpracovává list
 * CASH OPERATION HISTORY / HISTORIE PENĚŽNÍCH OPERACÍ; hlavičky i typy operací
 * mapuje EN/CZ podle názvů. Export neobsahuje ISIN ani měnu instrumentu —
 * dodává je `instrumentMap`; Amount u obchodů je dopad na hotovost v měně ÚČTU,
 * cena instrumentu se čte z komentáře („OPEN BUY 5 @ 458.65“).
 */
export async function parseXtbXlsx(
  data: ArrayBuffer | Buffer,
  instrumentMap: XtbInstrumentMap = {},
): Promise<ImportResult & { unmappedSymbols: string[] }> {
  const result = { ...emptyResult(XTB_BROKER), unmappedSymbols: [] as string[] };

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

  const sheet = findCashSheet(workbook);
  if (!sheet) {
    result.errors.push({
      line: 1,
      message: `Soubor neobsahuje list „CASH OPERATION HISTORY“ / „HISTORIE PENĚŽNÍCH OPERACÍ“ — nevypadá jako XTB Full report z xStation. Nalezené listy: ${workbook.worksheets.map((s) => s.name).join(', ') || '(žádné)'}`,
    });
    return result;
  }

  const rows = readSheetRows(sheet);
  // úplně prázdný list = prázdné období, ne chyba formátu
  if (rows.length === 0) return result;

  const header = findHeader(rows);
  if (!header) {
    result.errors.push({
      line: 1,
      message: `V listu „${sheet.name}“ se nepodařilo najít hlavičku tabulky (sloupce „ID“ a „Type/Typ“) — nevypadá jako XTB Full report.`,
    });
    return result;
  }
  const missing = (['time', 'amount'] as const).filter((f) => header.columns[f] === undefined);
  if (missing.length > 0) {
    result.errors.push({
      line: rows[header.index]!.rowNumber,
      message: `V hlavičce tabulky chybí sloupce: ${missing.map((f) => (f === 'time' ? 'Time/Čas' : 'Amount/Částka')).join(', ')} — bez nich nejde export zpracovat.`,
    });
    return result;
  }

  const detectedCurrency = detectAccountCurrency(rows.slice(0, header.index));
  let defaultCurrencyWarned = false;
  /** Měna účtu pro INTEREST/FEE/DEPOSIT/WITHDRAWAL — detekovaná, jinak EUR + warning. */
  const accountCurrency = (line: number): string => {
    if (detectedCurrency) return detectedCurrency;
    if (!defaultCurrencyWarned) {
      defaultCurrencyWarned = true;
      result.warnings.push({
        line,
        message: `Report neuvádí měnu účtu — u úroků, poplatků, vkladů a výběrů předpokládáme ${DEFAULT_ACCOUNT_CURRENCY}. Pokud je účet veden v jiné měně, transakce uprav ručně.`,
      });
    }
    return DEFAULT_ACCOUNT_CURRENCY;
  };

  // stabilní obsahová ID pro řádky bez XTB ID; identické řádky rozliší suffix -2, -3…
  const idOccurrences = new Map<string, number>();
  const contentId = (parts: string[]): string => {
    const base = `xtb-${fnv1a64(parts.join('|'))}`;
    const seen = (idOccurrences.get(base) ?? 0) + 1;
    idOccurrences.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  };

  const seenIds = new Set<string>();
  const push = (line: number, raw: string, candidate: Record<string, unknown>): void => {
    try {
      const tx = TransactionSchema.parse(candidate);
      if (seenIds.has(tx.id)) {
        result.warnings.push({
          line,
          message: `Duplicitní ID transakce ${tx.id} — deduplikace záznamy sloučí. Zkontroluj, zda nejde o dvě skutečné operace.`,
        });
      }
      seenIds.add(tx.id);
      result.transactions.push(tx);
    } catch (error) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${error instanceof Error ? error.message : String(error)}`,
        raw,
      });
    }
  };

  const unmapped = new Set<string>();
  /**
   * ISIN+měna z mapování pro BUY/SELL; bez nich obchod neemitujeme — JEDEN error
   * per symbol. Dividendy mapování nepotřebují (měna účtu, ISIN optional).
   */
  const requireInstrument = (
    symbol: string,
    line: number,
  ): { isin: string; currency: string } | null => {
    const instrument = instrumentMap[symbol];
    if (instrument?.currency) return { isin: instrument.isin, currency: instrument.currency };
    if (!unmapped.has(symbol)) {
      unmapped.add(symbol);
      result.errors.push({
        line,
        message: `Symbol ${symbol}: doplň ISIN a měnu instrumentu (XTB je neexportuje).`,
      });
    }
    return null;
  };

  // dividenda + srážková daň jsou samostatné řádky → 1:1 párování přes symbol+den
  interface PendingDividend {
    line: number;
    raw: string;
    symbol: string;
    date: string;
    id: string;
    gross: Decimal;
    /** ISIN z mapování, pokud existuje — u dividend je optional, měnu určuje účet. */
    isin?: string;
  }
  interface PendingWithholding {
    line: number;
    symbol: string;
    date: string;
    amount: Decimal;
  }
  const pendingDividends: PendingDividend[] = [];
  const pendingWithholdings = new Map<string, PendingWithholding[]>();
  const withholdingKey = (symbol: string, date: string): string => `${symbol}|${date}`;

  for (let i = header.index + 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const line = row.rowNumber;
    const raw = row.cells.join(' | ');
    const cell = (field: Field): string => {
      const col = header.columns[field];
      return col === undefined ? '' : (row.cells[col] ?? '');
    };

    const type = cell('type');
    const time = cell('time');
    const comment = cell('comment');
    const symbol = cell('symbol');
    const explicitId = cell('id');

    if (type === '') {
      // řádky bez typu pod tabulkou (mezisoučty reportu) — vědomě mimo import
      result.skipped.push({ line, message: 'Řádek bez typu operace (souhrn reportu) — přeskočen.', raw });
      continue;
    }

    const date = toIsoDate(time);
    if (!date) {
      result.errors.push({
        line,
        message: `Neplatný čas „${time}“ (očekáván formát DD.MM.YYYY HH:mm:ss nebo ISO).`,
        raw,
      });
      continue;
    }

    const amount = parseAmount(cell('amount'));
    const rowId =
      explicitId !== ''
        ? `xtb-${explicitId}`
        : contentId([type, time, symbol, comment, cell('amount')]);

    const kind = classifyOperation(type, comment);
    switch (kind) {
      case 'BUY':
      case 'SELL': {
        if (symbol === '') {
          result.errors.push({ line, message: `${type}: chybí symbol instrumentu.`, raw });
          break;
        }
        const instrument = requireInstrument(symbol, line);
        const trade = parseTradeComment(comment);
        if (!trade) {
          result.errors.push({
            line,
            message: `${type}: z komentáře „${comment}“ se nepodařilo přečíst počet kusů a cenu (očekáván tvar „OPEN BUY 5 @ 458.65“).`,
            raw,
          });
          break;
        }
        if (!instrument) break; // error per symbol už je nahlášený
        const quantity = parseAmount(trade.quantity);
        const price = parseAmount(trade.price);
        if (!quantity || quantity.lte(0) || !price || price.lt(0)) {
          result.errors.push({
            line,
            message: `${type}: neplatný počet kusů nebo cena v komentáři „${comment}“.`,
            raw,
          });
          break;
        }
        // Amount řádku = dopad na hotovost v měně ÚČTU → pro obchod nepoužíváme;
        // cena instrumentu je hodnota za „@“ v měně instrumentu z mapování
        push(line, raw, {
          type: kind,
          id: rowId,
          isin: instrument.isin,
          ticker: symbol,
          quantity: quantity.toString(),
          pricePerShare: price.toString(),
          currency: instrument.currency,
          tradeDate: date,
        });
        break;
      }
      case 'DIVIDEND': {
        if (symbol === '') {
          result.errors.push({ line, message: 'Dividenda bez symbolu — nelze ji spárovat se srážkovou daní.', raw });
          break;
        }
        if (!amount || amount.lte(0)) {
          result.errors.push({ line, message: `Dividenda ${symbol}: chybí kladná částka.`, raw });
          break;
        }
        // Amount dividendy je už přepočtený do měny ÚČTU → mapování symbolů
        // nepotřebujeme; ISIN doplníme, jen pokud ho mapa zná (je optional)
        pendingDividends.push({
          line,
          raw,
          symbol,
          date,
          id: rowId,
          gross: amount,
          isin: instrumentMap[symbol]?.isin,
        });
        break;
      }
      case 'WITHHOLDING': {
        if (!amount) {
          result.errors.push({ line, message: `Srážková daň ${symbol}: chybí částka.`, raw });
          break;
        }
        const key = withholdingKey(symbol, date);
        const queue = pendingWithholdings.get(key) ?? [];
        queue.push({ line, symbol, date, amount: amount.abs() });
        pendingWithholdings.set(key, queue);
        break;
      }
      case 'INTEREST': {
        if (!amount || amount.lt(0)) {
          result.errors.push({ line, message: `${type}: chybí kladná částka úroku.`, raw });
          break;
        }
        push(line, raw, {
          type: 'INTEREST',
          id: rowId,
          amount: amount.toString(),
          currency: accountCurrency(line),
          date,
          note: comment || undefined,
        });
        break;
      }
      case 'INTEREST_TAX': {
        if (!amount) {
          result.errors.push({ line, message: `${type}: chybí částka.`, raw });
          break;
        }
        const currency = accountCurrency(line);
        // daň z úroků nesmí tiše zmizet — evidujeme jako FEE a upozorníme
        push(line, raw, {
          type: 'FEE',
          id: rowId,
          amount: amount.abs().toString(),
          currency,
          date,
          note: 'daň z úroků stržená brokerem',
        });
        result.warnings.push({
          line,
          message: `Daň z úroků ${amount.abs().toString()} ${currency} stržená brokerem — evidujeme ji jako poplatek, aby nezapadla; úrok samotný vstupuje do § 8 v hrubé výši.`,
        });
        break;
      }
      case 'FEE': {
        if (!amount) {
          result.errors.push({ line, message: `${type}: chybí částka poplatku.`, raw });
          break;
        }
        push(line, raw, {
          type: 'FEE',
          id: rowId,
          amount: amount.abs().toString(),
          currency: accountCurrency(line),
          date,
          note: comment || undefined,
        });
        break;
      }
      case 'DEPOSIT':
      case 'WITHDRAWAL': {
        if (!amount) {
          result.errors.push({ line, message: `${type}: chybí částka.`, raw });
          break;
        }
        push(line, raw, {
          type: kind,
          id: rowId,
          amount: amount.abs().toString(),
          currency: accountCurrency(line),
          date,
          note: comment || undefined,
        });
        break;
      }
      case 'UNKNOWN': {
        result.errors.push({
          line,
          message: `Neznámý typ operace „${type}“ — nahlaš nám ho, doplníme podporu.`,
          raw,
        });
        break;
      }
    }
  }

  // párování srážek k dividendám (1:1 symbol+den, v pořadí řádků); dividenda
  // i srážka jsou v měně ÚČTU — XTB je připisuje po přepočtu
  for (const dividend of pendingDividends) {
    const queue = pendingWithholdings.get(withholdingKey(dividend.symbol, dividend.date));
    const withholding = queue?.shift();
    const currency = accountCurrency(dividend.line);
    push(dividend.line, dividend.raw, {
      type: 'DIVIDEND',
      id: dividend.id,
      isin: dividend.isin,
      ticker: dividend.symbol,
      gross: dividend.gross.toString(),
      currency,
      withholdingTax: withholding ? withholding.amount.toString() : '0',
      date: dividend.date,
    });
    result.warnings.push({
      line: dividend.line,
      message: `Dividenda ${dividend.symbol}: XTB dividendy připisuje přepočtené do měny účtu (${currency}) — brutto v původní měně export neobsahuje.`,
    });
  }
  for (const queue of pendingWithholdings.values()) {
    for (const leftover of queue) {
      result.warnings.push({
        line: leftover.line,
        message: `Srážková daň ${leftover.amount.toString()} (${leftover.symbol || 'bez symbolu'}, ${leftover.date}) bez párové dividendy v týž den — nezaúčtována, zkontroluj export za celé období.`,
      });
    }
  }

  result.unmappedSymbols = [...unmapped];
  return result;
}

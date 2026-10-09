import ExcelJS from 'exceljs';
import { Decimal, d, TransactionSchema } from '@danero/shared';
import { cleanNumber, isValidIsoDate, normalizeHeader, stripDiacritics } from '../csv';
import { fnv1a64 } from '../dedupe';
import { readSheetRows, type SheetRow } from '../xlsx';
import { emptyResult, type ImportResult } from '../types';

export const XTB_BROKER = 'xtb';

/**
 * XTB export neobsahuje měnu instrumentu ani ISIN (docs/03) — dodává je mapování
 * symbolů. Obchod ani dividenda bez mapování se neimportuje a symbol skončí
 * v `unmappedSymbols`; dividendě stačí ISIN (částku má v měně účtu).
 */
export interface XtbInstrumentMap {
  /**
   * Měna je volitelná: dividendám XTB stačí ISIN (jsou v měně účtu), obchod bez
   * měny instrumentu ale spočítat nejde — takový symbol se hlásí k doplnění.
   */
  [symbol: string]: { isin: string; currency?: string };
}

/**
 * Měna instrumentu, pokud ji jde poznat z tickeru — jen NÁVRH pro formulář
 * číselníku, parser ji sám nepoužívá (obchod se dál ukládá až s tím, co
 * uživatel v číselníku potvrdil).
 *
 * Jediná jednoznačná přípona je `.US` (americké burzy, USD). Jiné se nehádají:
 * `.UK` může být v librách, v pencích i v dolarech — `IWDA.UK` se obchoduje
 * v USD — a špatně předvyplněná měna je horší než prázdné pole, protože projde
 * bez jediného varování a přepočítá nabývací cenu jiným kurzem.
 */
export function xtbCurrencyFromTicker(symbol: string): string | undefined {
  return /^.+\.US$/.test(symbol.trim().toUpperCase()) ? 'USD' : undefined;
}

/**
 * Fallback měny účtu, když ji report neuvádí — EXPLICITNĚ EUR (nejčastější měna
 * XTB účtů českých klientů po přechodu na EUR onboarding); použití vždy doprovází warning.
 */
const DEFAULT_ACCOUNT_CURRENCY = 'EUR';

/**
 * Názvy listu s peněžními operacemi, porovnává se bez diakritiky.
 *
 * První dva jsou „Full report“ (EN/CZ), třetí je report z tlačítka
 * „Export (new)“. Ten XTB přestavěl celý: jiné názvy listů, sloupec `Ticker`
 * místo `Symbol`, typy `Stock purchase` / `Stock sell`, pod tabulkou řádek
 * `Total` a měna účtu jen na listu otevřených pozic. Do 7. 10. 2026 jsme ho
 * podle názvu listu nepoznali vůbec a uživatel s reportem z XTB četl
 * „XLSX nepoznáváme — podporujeme reporty XTB…“.
 */
const CASH_SHEET_NAMES = ['CASH OPERATION HISTORY', 'HISTORIE PENEZNICH OPERACI', 'CASH OPERATIONS'];

/** Listy nového reportu, ze kterých čteme doplňující údaje. */
const OPEN_POSITIONS_SHEET_NAMES = ['OPEN POSITIONS'];
const CLOSED_POSITIONS_SHEET_NAMES = ['CLOSED POSITIONS'];

/** Sloupce tabulky — synonyma EN/CZ hlaviček (bez diakritiky, lowercase). */
const HEADER_SYNONYMS = {
  id: ['id'],
  type: ['type', 'typ'],
  time: ['time', 'cas'],
  comment: ['comment', 'komentar'],
  symbol: ['symbol', 'ticker'],
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

/** List podle názvu — bez ohledu na diakritiku, velikost písmen a mezery navíc. */
function findSheet(
  workbook: ExcelJS.Workbook,
  names: readonly string[],
): ExcelJS.Worksheet | undefined {
  return workbook.worksheets.find((sheet) =>
    names.includes(stripDiacritics(sheet.name).replace(/\s+/g, ' ').trim().toUpperCase()),
  );
}

const findCashSheet = (workbook: ExcelJS.Workbook): ExcelJS.Worksheet | undefined =>
  findSheet(workbook, CASH_SHEET_NAMES);

/** Autodetekce: XTB report se pozná podle listu peněžních operací. */
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

/**
 * Měna účtu v novém reportu: nad tabulkou peněžních operací už není, najde se
 * ve sloupci `Currency` souhrnu na listu otevřených pozic.
 *
 * Čte se jen řádek hned pod první hlavičkou s tím sloupcem. Hledat hlouběji
 * nejde: pod souhrnem leží tabulka pozic a v témže sloupci má `Category` —
 * „ETF“ jsou taky tři velká písmena.
 */
function detectCurrencyFromOpenPositions(workbook: ExcelJS.Workbook): string | null {
  const sheet = findSheet(workbook, OPEN_POSITIONS_SHEET_NAMES);
  if (!sheet) return null;
  const rows = readSheetRows(sheet);
  const headerIndex = rows.findIndex((row) => row.cells.map(normalizeHeader).includes('currency'));
  if (headerIndex === -1) return null;
  const column = rows[headerIndex]!.cells.map(normalizeHeader).indexOf('currency');
  const value = rows[headerIndex + 1]?.cells[column] ?? '';
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

/** Jak XTB nový report pojmenuje: `CZK_1234567_2025-01-01_2025-12-31.xlsx`. */
const REPORT_FILENAME_RE = /^([A-Z]{3})_(\d+)_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}/;

/**
 * Poslední záchrana pro měnu účtu: název souboru. Uživatel si ho může přepsat,
 * takže mu věříme jen tehdy, když číslo účtu v něm sedí s číslem v reportu.
 */
function detectCurrencyFromFilename(filename: string | undefined, preambleRows: SheetRow[]): string | null {
  const match = filename ? REPORT_FILENAME_RE.exec(filename) : null;
  if (!match) return null;
  const account = preambleRows.find((row) => normalizeHeader(row.cells[0] ?? '') === 'account number');
  return account?.cells[1] === match[2] ? match[1]! : null;
}

/** Pozice, kterou XTB uzavřel sám, opravou (list uzavřených pozic). */
interface PositionCorrection {
  line: number;
  symbol: string;
  date: string | null;
  comment: string;
  sheetName: string;
}

/**
 * Uzavření s původem `Correction` z listu uzavřených pozic nového reportu.
 *
 * XTB tak vede třeba odpis bezcenného titulu (komentář „… Worthless“): pozice
 * se uzavře za nákupní cenu, peníze se nepohnou a v peněžních operacích po tom
 * nezůstane ani stopa. Jak s tím naložit daňově, docs/02 neřeší — proto jen
 * upozorníme a nic neimportujeme. Jeden titul bývá rozepsaný na víc řádků
 * (co lot, to řádek), hlásí se jednou.
 */
function readPositionCorrections(workbook: ExcelJS.Workbook): PositionCorrection[] {
  const sheet = findSheet(workbook, CLOSED_POSITIONS_SHEET_NAMES);
  if (!sheet) return [];
  const rows = readSheetRows(sheet);
  const headerIndex = rows.findIndex((row) => {
    const cells = row.cells.map(normalizeHeader);
    return cells.includes('ticker') && cells.includes('close origin');
  });
  if (headerIndex === -1) return [];
  const header = rows[headerIndex]!.cells.map(normalizeHeader);
  const ticker = header.indexOf('ticker');
  const origin = header.indexOf('close origin');
  const closeTime = header.findIndex((cell) => cell.startsWith('close time'));
  const comment = header.indexOf('comment');

  const seen = new Set<string>();
  const corrections: PositionCorrection[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const cell = (index: number): string => (index === -1 ? '' : (row.cells[index] ?? ''));
    if (cell(origin).toLowerCase() !== 'correction' || cell(ticker) === '') continue;
    const key = [cell(ticker), cell(closeTime), cell(comment)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    corrections.push({
      line: row.rowNumber,
      symbol: cell(ticker),
      date: toIsoDate(cell(closeTime)),
      comment: cell(comment),
      sheetName: sheet.name,
    });
  }
  return corrections;
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
  // nový report píše „Stock purchase“ / „Stock sell“; variantu pro ETF známe
  // jen analogií (reálný vzorek obsahoval samé akcie)
  if (t.includes('stocks/etf purchase') || t.includes('nakup akcii/etf') || /^(stock|etf) purchase$/.test(t)) {
    return 'BUY';
  }
  if (t.includes('stocks/etf sale') || t.includes('prodej akcii/etf') || /^(stock|etf) (sell|sale)$/.test(t)) {
    return 'SELL';
  }
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
  // „SEC fee“ — poplatek americkému regulátorovi stržený po prodeji
  if (/\bfee$/.test(t)) return 'FEE';
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
 * Parser XTB xStation XLSX (docs/03) — starý „Full report“ i nový report
 * z tlačítka „Export (new)“. Zpracovává list peněžních operací
 * (CASH OPERATION HISTORY / HISTORIE PENĚŽNÍCH OPERACÍ / Cash Operations);
 * hlavičky i typy operací mapuje podle názvů. Export neobsahuje ISIN ani měnu
 * instrumentu — dodává je `instrumentMap`; Amount u obchodů je dopad na
 * hotovost v měně ÚČTU, cena instrumentu se čte z komentáře
 * („OPEN BUY 5 @ 458.65“).
 *
 * Z nového reportu se navíc čte měna účtu (list otevřených pozic, v nouzi
 * název souboru) a pozice, které XTB uzavřel opravou (list uzavřených pozic)
 * — obojí v peněžních operacích chybí.
 */
export async function parseXtbXlsx(
  data: ArrayBuffer | Buffer,
  instrumentMap: XtbInstrumentMap = {},
  options: { filename?: string } = {},
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
      message: `Soubor neobsahuje list „CASH OPERATION HISTORY“ / „HISTORIE PENĚŽNÍCH OPERACÍ“ / „Cash Operations“ — nevypadá jako XTB Full report z xStation. Nalezené listy: ${workbook.worksheets.map((s) => s.name).join(', ') || '(žádné)'}`,
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

  // Hlásí se PŘED řádky tabulky: historie importů ukazuje jen prvních pár
  // upozornění a tohle je jediné, které se netýká peněžní operace.
  for (const correction of readPositionCorrections(workbook)) {
    result.warnings.push({
      line: correction.line,
      message:
        `List „${correction.sheetName}“: XTB uzavřel pozici ${correction.symbol} opravou z vlastního podnětu` +
        (correction.date ? ` (${correction.date})` : '') +
        (correction.comment ? `, poznámka „${correction.comment}“` : '') +
        '. V peněžních operacích k tomu nemusí být žádný záznam — Danero pak titul dál eviduje jako držený. Zkontroluj si ho v přehledu pozic.',
    });
  }

  const preamble = rows.slice(0, header.index);
  const detectedCurrency =
    detectAccountCurrency(preamble) ??
    detectCurrencyFromOpenPositions(workbook) ??
    detectCurrencyFromFilename(options.filename, preamble);
  let defaultCurrencyWarned = false;
  /** Měna účtu pro DIVIDEND/INTEREST/FEE/DEPOSIT/WITHDRAWAL — detekovaná, jinak EUR + warning. */
  const accountCurrency = (line: number): string => {
    if (detectedCurrency) return detectedCurrency;
    if (!defaultCurrencyWarned) {
      defaultCurrencyWarned = true;
      result.warnings.push({
        line,
        message: `Report neuvádí měnu účtu — u dividend, úroků, poplatků, vkladů a výběrů předpokládáme ${DEFAULT_ACCOUNT_CURRENCY}. Pokud je účet veden v jiné měně, vrať import zpět tlačítkem v historii a napiš nám — částky by jinak byly ve špatné měně.`,
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
    /** ISIN z mapování; null = titul čeká na číselník a dividenda se zatím neuloží. */
    isin: string | null;
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
    if (type.toLowerCase() === 'total' && time === '' && explicitId === '') {
      // nový report končí součtem sloupce Amount; operace má vždy čas i ID
      result.skipped.push({ line, message: 'Řádek „Total“ (součet reportu) — přeskočen.', raw });
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
        // Amount dividendy je už přepočtený do měny ÚČTU, takže měnu z číselníku
        // nepotřebuje — ISIN ale ano. Bez něj se dřív uložila taky a po doplnění
        // číselníku a novém nahrání výpisu PODRUHÉ: ISIN je součást obsahového
        // otisku, takže táž dividenda s ISIN vypadá jako jiná událost.
        const isin = instrumentMap[symbol]?.isin ?? null;
        if (!isin) requireInstrument(symbol, line);
        pendingDividends.push({ line, raw, symbol, date, id: rowId, gross: amount, isin });
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
    // srážku si z fronty bere i dividenda čekající na ISIN — jinak by ji
    // dostala další dividenda téhož titulu, nebo by zbyla „bez párové dividendy“
    const withholding = queue?.shift();
    if (!dividend.isin) continue;
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

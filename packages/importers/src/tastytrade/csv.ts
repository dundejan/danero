import { Decimal, d, TransactionSchema, ZERO } from '@danero/shared';
import { HeaderMap, isValidIsoDate, parseCsv } from '../csv';
import { fnv1a64 } from '../dedupe';
import { parseUsDate } from '../csv';
import { emptyResult, type ImportResult, type IsinInstrumentMap } from '../types';

export const TASTYTRADE_BROKER = 'tastytrade';

/** Tastytrade je US broker — legacy export měnu neuvádí, nový má sloupec Currency. */
const USD = 'USD';

/**
 * Výpis Tastytrade neobsahuje ISIN (jen Symbol) — u akcií ho dodává mapování
 * symbolů (vzor XTB/Revolut). BUY/SELL akcií bez mapování se neimportuje
 * a symbol skončí v `unmappedSymbols`; dividendy mapování nepotřebují
 * (ISIN je u nich optional) a opce mají stabilní identifikátor `OPT:…`.
 */
export type TastytradeInstrumentMap = IsinInstrumentMap;

/** Číselná hodnota Tastytrade: tisícové čárky („1,000.00“); literál „--“ = prázdno. */
function parseTastyNumber(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '--') return null;
  const digits = trimmed.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(digits)) return null;
  return digits;
}

/* ── Slovníky Sub Type (case-sensitive dle reálných exportů) ──────────────── */

/** Zánik opce bez Action — směr určuje sledování čisté pozice (tracker). */
const REMOVAL_SUBTYPES = new Map<string, string>([
  ['Expiration', 'Expirace opce (uzavření za 0)'],
  ['Assignment', 'Assignment — zánik opce uplatněním (uzavření za 0)'],
  ['Exercise', 'Exercise — zánik opce uplatněním (uzavření za 0)'],
  ['Cash Settled Assignment', 'Cash settled assignment — zánik opce (uzavření za 0)'],
  ['Cash Settled Exercise', 'Cash settled exercise — zánik opce (uzavření za 0)'],
]);

const SPLIT_WARNING = 'výpis neuvádí poměr splitu — doplň korporátní akci přes univerzální šablonu';

/** Receive Deliver podtypy vědomě přeskočené S varováním. */
const RD_WARN_SKIP = new Map<string, string>([
  ['Forward Split', SPLIT_WARNING],
  ['Reverse Split', SPLIT_WARNING],
  ['Symbol Change', 'změna symbolu — doplň korporátní akci (změna ISIN) přes univerzální šablonu'],
  ['Stock Merger', 'fúze — doplň korporátní akci (nový ISIN, poměr výměny) přes univerzální šablonu'],
  ['Cash Merger', 'fúze s výplatou v hotovosti — doplň prodej přes univerzální šablonu'],
  ['Special Dividend', 'mimořádná distribuce kusů — doplň ji přes univerzální šablonu'],
  ['Futures Settlement', 'vypořádání futures zatím nepodporujeme — doplň ho přes univerzální šablonu'],
  ['Maturity', 'splatnost instrumentu zatím nepodporujeme — doplň ji přes univerzální šablonu'],
]);

/** Převody pozic — vědomý skip; pro výpočet je případně nahradí TRANSFER_IN/OUT. */
const RD_SILENT_SKIP = new Set(['Transfer', 'ACAT']);

/** Money Movement podtypy vědomě přeskočené S varováním. */
const MM_WARN_SKIP = new Map<string, string>([
  ['Balance Adjustment', 'úprava zůstatku brokerem — neumíme ji daňově zařadit, zkontroluj výpis'],
  ['Mark to Market', 'denní přecenění (mark-to-market) — do výpočtu nevstupuje, vypořádání nesou obchody'],
  [
    'Fully Paid Stock Lending Income',
    'příjem z půjčování akcií — zatím ho nezařazujeme; pokud je daňově relevantní, doplň ho přes univerzální šablonu',
  ],
]);

/** Peněžní převody — pro daňový výpočet nejsou potřeba. */
const MM_SILENT_SKIP = new Set(['Deposit', 'Withdrawal', 'Transfer']);

/** Párování srážky k dividendě: stejný symbol, nejbližší datum do ±5 dní. */
const TAX_MATCH_MAX_DAYS = 5;

const dayDistance = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Autodetekce Tastytrade exportu: nová generace má sloupce „Sub Type“
 * a „Underlying Symbol“, legacy „Transaction Code“ a „Account Reference“.
 */
export function sniffTastytradeCsv(text: string): boolean {
  if (text.trim() === '') return false;
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const { headers } = parseCsv(firstLine);
  const has = (name: string): boolean => headers.includes(name);
  return (
    (has('Sub Type') && has('Underlying Symbol')) ||
    (has('Transaction Code') && has('Account Reference'))
  );
}

/** Sjednocený tvar řádku obou generací exportu — mapování výhradně podle názvů sloupců. */
interface NormalizedRow {
  line: number;
  cells: string[];
  raw: string;
  dateRaw: string;
  date: string | null;
  /** Type (nový formát) / Transaction Code (legacy). */
  code: string;
  /** Sub Type / Transaction Subcode. */
  subType: string;
  /** Původní hodnota Action / Buy-Sell (pro chybové hlášky). */
  actionRaw: string;
  direction: 'BUY' | 'SELL' | null;
  symbol: string;
  underlying: string;
  instrumentRaw: string;
  isOption: boolean;
  /** Stabilní identifikátor opce `OPT:…` — zároveň klíč pozičního trackeru. */
  optionIsin: string | null;
  quantityRaw: string;
  /** Average Price (nový) / Price (legacy). */
  priceRaw: string;
  /** Value (nový) / Amount (legacy). */
  valueRaw: string;
  fee: Decimal;
  description: string;
  currency: string;
  generation: 'v2' | 'legacy';
}

/**
 * Parser Tastytrade „History → Transactions“ CSV. Podporuje tři hlavičky:
 * novou 20sloupcovou, 21sloupcovou (navíc „Total“) a legacy 15sloupcovou
 * (tastyworks). YTD daňový export z Tax Center se odmítá. Řádky jsou řazené
 * od nejnovějšího → zpracovávají se ODSPODU (chronologicky), aby fungovalo
 * sledování čisté pozice opcí — zániky opcí (expirace/assignment/exercise)
 * nemají směr a určuje ho právě tracker: long → SELL @ 0, short → BUY @ 0.
 */
export function parseTastytradeCsv(
  text: string,
  instrumentMap: TastytradeInstrumentMap = {},
): ImportResult & { unmappedSymbols: string[] } {
  const result = { ...emptyResult(TASTYTRADE_BROKER), unmappedSymbols: [] as string[] };
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const { headers, rows } = parseCsv(text);
  if (headers.some((h) => h.includes('SEC_SUBTYPE') || h.includes('8949_CODE'))) {
    result.errors.push({
      line: 1,
      message:
        'Nahraj export z History → Transactions (CSV), ne Year-to-Date Data Export z Tax Center.',
    });
    return result;
  }
  const map = new HeaderMap(headers);
  const legacy = map.has('Transaction Code') && map.has('Account Reference');
  const v2 = map.has('Sub Type') && map.has('Underlying Symbol');
  if (!legacy && !v2) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako Tastytrade export (History → Transactions). Nalezené sloupce: ${headers.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }
  const required = legacy
    ? ['Date/Time', 'Transaction Subcode', 'Symbol', 'Buy/Sell', 'Quantity', 'Price', 'Fees', 'Amount']
    : ['Date', 'Type', 'Action', 'Symbol', 'Instrument Type', 'Value', 'Quantity', 'Average Price', 'Commissions', 'Fees'];
  const missing = required.filter((name) => !map.has(name));
  if (missing.length > 0) {
    result.errors.push({
      line: 1,
      message: `V hlavičce exportu chybí sloupce: ${missing.join(', ')} — bez nich export nejde zpracovat.`,
    });
    return result;
  }

  const abs = (raw: string | null): Decimal => (raw === null ? ZERO : d(raw).abs());

  const normalizeV2 = (row: string[], line: number): NormalizedRow => {
    const symbol = map.get(row, 'Symbol');
    const instrumentRaw = map.get(row, 'Instrument Type');
    const isOption = instrumentRaw === 'Equity Option';
    const actionRaw = map.get(row, 'Action');
    const direction =
      actionRaw === 'BUY_TO_OPEN' || actionRaw === 'BUY_TO_CLOSE'
        ? 'BUY'
        : actionRaw === 'SELL_TO_OPEN' || actionRaw === 'SELL_TO_CLOSE'
          ? 'SELL'
          : null;
    // Datum je ISO čas s offsetem bez dvojtečky (+0200); offset se mění podle
    // časové zóny prohlížeče při exportu, takže jediné stabilní je DATUM
    // lokálního času (prvních 10 znaků) — den, jak ho uživatel viděl v aplikaci.
    const dateRaw = map.get(row, 'Date');
    const localDate = dateRaw.slice(0, 10);
    const currencyRaw = map.get(row, 'Currency');
    return {
      line,
      cells: row,
      raw: row.join(','),
      dateRaw,
      date: isValidIsoDate(localDate) ? localDate : null,
      code: map.get(row, 'Type'),
      subType: map.get(row, 'Sub Type'),
      actionRaw,
      direction,
      symbol,
      underlying: map.get(row, 'Underlying Symbol') || map.get(row, 'Root Symbol') || symbol,
      instrumentRaw,
      isOption,
      // OCC symbol má vícenásobné mezery → jedna pomlčka („OPT:SCHG-240920C00099000“)
      optionIsin: isOption && symbol !== '' ? `OPT:${symbol.replace(/\s+/g, '-')}` : null,
      quantityRaw: map.get(row, 'Quantity'),
      priceRaw: map.get(row, 'Average Price'),
      valueRaw: map.get(row, 'Value'),
      fee: abs(parseTastyNumber(map.get(row, 'Commissions'))).plus(
        abs(parseTastyNumber(map.get(row, 'Fees'))),
      ),
      description: map.get(row, 'Description'),
      currency: currencyRaw === '' ? USD : currencyRaw,
      generation: 'v2',
    };
  };

  const normalizeLegacy = (row: string[], line: number): NormalizedRow => {
    const symbol = map.get(row, 'Symbol');
    const callPut = map.get(row, 'Call/Put').toUpperCase();
    const isOption = callPut !== '';
    const buySell = map.get(row, 'Buy/Sell');
    const direction = buySell === 'Buy' ? 'BUY' : buySell === 'Sell' ? 'SELL' : null;
    const dateRaw = map.get(row, 'Date/Time');
    const expiration = parseUsDate(map.get(row, 'Expiration Date'));
    const strike = parseTastyNumber(map.get(row, 'Strike'));
    return {
      line,
      cells: row,
      raw: row.join(','),
      dateRaw,
      // „MM/DD/YYYY H:MM AM/PM“ — parseUsDate čte datum, čas ignoruje
      date: parseUsDate(dateRaw),
      code: map.get(row, 'Transaction Code'),
      subType: map.get(row, 'Transaction Subcode'),
      actionRaw: buySell,
      direction,
      symbol,
      underlying: symbol,
      instrumentRaw: isOption ? 'Equity Option' : 'Equity',
      isOption,
      // legacy nemá OCC symbol — identifikátor skládáme z podkladu, expirace, strike a C/P
      optionIsin:
        isOption && symbol !== '' && expiration !== null && strike !== null
          ? `OPT:${symbol}-${expiration}-${strike}-${callPut[0]}`
          : null,
      quantityRaw: map.get(row, 'Quantity'),
      priceRaw: map.get(row, 'Price'),
      valueRaw: map.get(row, 'Amount'),
      fee: abs(parseTastyNumber(map.get(row, 'Fees'))),
      description: map.get(row, 'Description'),
      currency: USD,
      generation: 'legacy',
    };
  };

  // stabilní obsahová id; identické legitimní řádky rozliší suffix -2, -3…
  const idOccurrences = new Map<string, number>();
  const nextId = (cells: string[]): string => {
    const base = `tasty-${fnv1a64(cells.join('|'))}`;
    const count = (idOccurrences.get(base) ?? 0) + 1;
    idOccurrences.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  const push = (line: number, raw: string, candidate: Record<string, unknown>): void => {
    try {
      result.transactions.push(TransactionSchema.parse(candidate));
    } catch (err) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw,
      });
    }
  };

  const unmapped = new Set<string>();
  /** ISIN z mapování pro BUY/SELL akcií; bez něj obchod neemitujeme — JEDEN error per symbol. */
  const requireIsin = (symbol: string, line: number): string | null => {
    const instrument = instrumentMap[symbol];
    if (instrument) return instrument.isin;
    if (!unmapped.has(symbol)) {
      unmapped.add(symbol);
      result.errors.push({
        line,
        message: `Symbol ${symbol}: doplň ISIN instrumentu (Tastytrade ho neexportuje).`,
      });
    }
    return null;
  };

  /** Čistá pozice v kontraktech per opce (klíč = optionIsin), plněná chronologicky. */
  const tracker = new Map<string, Decimal>();
  const positionOf = (key: string): Decimal => tracker.get(key) ?? ZERO;
  const trackTrade = (key: string, direction: 'BUY' | 'SELL', quantity: Decimal): void => {
    tracker.set(
      key,
      direction === 'BUY' ? positionOf(key).plus(quantity) : positionOf(key).minus(quantity),
    );
  };

  // dividenda a záporná srážka jsou samostatné řádky → párování druhým průchodem
  interface PendingDividend {
    line: number;
    raw: string;
    id: string;
    symbol: string;
    date: string;
    gross: string;
    currency: string;
    isin?: string;
    withholding?: string;
  }
  interface PendingTax {
    line: number;
    symbol: string;
    date: string;
    amount: string;
  }
  const dividends: PendingDividend[] = [];
  const taxes: PendingTax[] = [];

  const processTrade = (norm: NormalizedRow): void => {
    const { line, raw } = norm;
    const quantityRaw = parseTastyNumber(norm.quantityRaw);
    const quantity = quantityRaw === null ? null : d(quantityRaw).abs();
    if (!quantity || quantity.lte(0)) {
      result.errors.push({
        line,
        message: `${norm.actionRaw} ${norm.symbol}: chybí kladný počet (Quantity „${norm.quantityRaw}“).`,
        raw,
      });
      return;
    }
    const fee = norm.fee.gt(0)
      ? { amount: norm.fee.toString(), currency: norm.currency }
      : undefined;

    if (norm.isOption) {
      if (norm.optionIsin === null) {
        result.errors.push({
          line,
          message: `Opci ${norm.symbol || 'bez symbolu'} chybí identifikace (symbol/expirace/strike) — řádek nejde zpracovat.`,
          raw,
        });
        return;
      }
      // prémie za KONTRAKT: nový formát |Value| / počet kontraktů,
      // legacy Price × 100 (multiplikátor opce; sloupec s ním legacy nemá)
      let perContract: Decimal | null = null;
      if (norm.generation === 'v2') {
        const value = parseTastyNumber(norm.valueRaw);
        if (value !== null) perContract = d(value).abs().div(quantity);
      } else {
        const price = parseTastyNumber(norm.priceRaw);
        if (price !== null) perContract = d(price).abs().mul(100);
      }
      if (perContract === null) {
        result.errors.push({
          line,
          message: `${norm.actionRaw} ${norm.symbol}: chybí hodnota obchodu — nejde určit prémii.`,
          raw,
        });
        return;
      }
      push(line, raw, {
        type: norm.direction,
        id: nextId(norm.cells),
        isin: norm.optionIsin,
        ticker: norm.underlying || undefined,
        name: norm.description || undefined,
        assetClass: 'DERIVATIVE',
        settlementStyle: 'PREMIUM',
        quantity: quantity.toString(),
        pricePerShare: perContract.toString(),
        currency: norm.currency,
        fee,
        tradeDate: norm.date,
      });
      trackTrade(norm.optionIsin, norm.direction!, quantity);
      return;
    }

    if (norm.instrumentRaw !== 'Equity') {
      result.warnings.push({
        line,
        message: `Instrument „${norm.instrumentRaw || 'neuvedený'}“ (${norm.symbol}) zatím nepodporujeme — řádek přeskočen; doplň ho přes univerzální šablonu.`,
      });
      return;
    }
    if (norm.symbol === '') {
      result.errors.push({ line, message: `${norm.actionRaw}: chybí symbol instrumentu.`, raw });
      return;
    }
    const price = parseTastyNumber(norm.priceRaw);
    if (price === null) {
      result.errors.push({
        line,
        message: `${norm.actionRaw} ${norm.symbol}: chybí cena za kus.`,
        raw,
      });
      return;
    }
    const isin = requireIsin(norm.symbol, line);
    if (isin === null) return; // error per symbol už je nahlášený
    push(line, raw, {
      type: norm.direction,
      id: nextId(norm.cells),
      isin,
      ticker: norm.symbol,
      name: norm.description || undefined,
      quantity: quantity.toString(),
      pricePerShare: d(price).abs().toString(),
      currency: norm.currency,
      fee,
      tradeDate: norm.date,
    });
  };

  const processReceiveDeliver = (norm: NormalizedRow): void => {
    const { line, raw } = norm;
    const removalNote = REMOVAL_SUBTYPES.get(norm.subType);
    if (removalNote !== undefined) {
      if (!norm.isOption || norm.optionIsin === null) {
        result.warnings.push({
          line,
          message: `„${norm.subType}“ u ${norm.symbol || 'řádku bez symbolu'} nevypadá jako opce — řádek přeskočen; doplň ho přes univerzální šablonu.`,
        });
        return;
      }
      const quantityRaw = parseTastyNumber(norm.quantityRaw);
      const quantity = quantityRaw === null ? null : d(quantityRaw).abs();
      if (!quantity || quantity.lte(0)) {
        result.errors.push({
          line,
          message: `${norm.subType} ${norm.symbol}: chybí počet kontraktů (Quantity „${norm.quantityRaw}“).`,
          raw,
        });
        return;
      }
      // směr zániku podle čisté pozice: long → SELL @ 0, short → BUY @ 0 (R-12i)
      const position = positionOf(norm.optionIsin);
      if (position.eq(0)) {
        result.warnings.push({
          line,
          message: `${norm.subType} ${norm.symbol}: ve výpisu nevidíme otevření pozice, směr uzavření neumíme určit — řádek přeskočen; zánik opce doplň přes univerzální šablonu (uzavření za 0).`,
        });
        return;
      }
      const type = position.gt(0) ? 'SELL' : 'BUY';
      push(line, raw, {
        type,
        id: nextId(norm.cells),
        isin: norm.optionIsin,
        ticker: norm.underlying || undefined,
        name: norm.description || undefined,
        assetClass: 'DERIVATIVE',
        settlementStyle: 'PREMIUM',
        quantity: quantity.toString(),
        pricePerShare: '0',
        currency: norm.currency,
        fee: norm.fee.gt(0) ? { amount: norm.fee.toString(), currency: norm.currency } : undefined,
        tradeDate: norm.date,
        note: removalNote,
      });
      trackTrade(norm.optionIsin, type, quantity);
      return;
    }
    const warnSkip = RD_WARN_SKIP.get(norm.subType);
    if (warnSkip !== undefined) {
      result.warnings.push({
        line,
        message: `„${norm.subType}“${norm.symbol ? ` (${norm.symbol})` : ''}: ${warnSkip}. Řádek přeskočen.`,
      });
      return;
    }
    if (RD_SILENT_SKIP.has(norm.subType)) {
      result.skipped.push({
        line,
        message: `„${norm.subType}“: převod pozic — pro výpočet ho případně doplň jako TRANSFER_IN/OUT přes univerzální šablonu.`,
      });
      return;
    }
    result.errors.push({
      line,
      message: `Neznámý typ záznamu „Receive Deliver / ${norm.subType}“ — nahlaš nám ho, doplníme podporu.`,
      raw,
    });
  };

  const processMoneyMovement = (norm: NormalizedRow): void => {
    const { line, raw } = norm;
    const amountRaw = parseTastyNumber(norm.valueRaw);

    if (norm.subType === 'Dividend') {
      if (amountRaw === null) {
        result.errors.push({
          line,
          message: `Dividenda ${norm.symbol || 'bez symbolu'}: chybí částka (Value „${norm.valueRaw}“).`,
          raw,
        });
        return;
      }
      const amount = d(amountRaw);
      if (amount.gt(0)) {
        dividends.push({
          line,
          raw,
          id: nextId(norm.cells),
          symbol: norm.symbol,
          date: norm.date!,
          gross: amount.toString(),
          currency: norm.currency,
          isin: instrumentMap[norm.symbol]?.isin,
        });
      } else if (amount.lt(0)) {
        // záporný řádek Dividend = srážková daň u zdroje
        taxes.push({ line, symbol: norm.symbol, date: norm.date!, amount: amount.abs().toString() });
      } else {
        result.warnings.push({
          line,
          message: `Nulová dividenda ${norm.symbol} — nezaúčtováno, zkontroluj výpis.`,
        });
      }
      return;
    }
    if (norm.subType === 'Credit Interest') {
      if (amountRaw === null) {
        result.errors.push({ line, message: 'Credit Interest: chybí částka úroku.', raw });
        return;
      }
      if (d(amountRaw).lte(0)) {
        result.warnings.push({
          line,
          message: `Záporný/nulový úrok ${amountRaw} — vypadá jako korekce, nezaúčtováno; zkontroluj výpis.`,
        });
        return;
      }
      push(line, raw, {
        type: 'INTEREST',
        id: nextId(norm.cells),
        amount: amountRaw,
        currency: norm.currency,
        date: norm.date,
        note: norm.description || undefined,
      });
      return;
    }
    if (norm.subType === 'Debit Interest') {
      result.skipped.push({
        line,
        message: '„Debit Interest“: debetní úrok je náklad — do daňového výpočtu ho nezařazujeme.',
      });
      return;
    }
    if (norm.subType === 'Fee') {
      if (amountRaw === null) {
        result.errors.push({ line, message: 'Fee: chybí částka poplatku.', raw });
        return;
      }
      push(line, raw, {
        type: 'FEE',
        id: nextId(norm.cells),
        amount: d(amountRaw).abs().toString(),
        currency: norm.currency,
        date: norm.date,
        note: norm.description || undefined,
      });
      return;
    }
    if (MM_SILENT_SKIP.has(norm.subType)) {
      result.skipped.push({
        line,
        message: `„${norm.subType}“: peněžní převod — pro daňový výpočet není potřeba.`,
      });
      return;
    }
    const warnSkip = MM_WARN_SKIP.get(norm.subType);
    if (warnSkip !== undefined) {
      result.warnings.push({ line, message: `„${norm.subType}“: ${warnSkip}. Řádek přeskočen.` });
      return;
    }
    result.errors.push({
      line,
      message: `Neznámý typ pohybu „Money Movement / ${norm.subType}“ — nahlaš nám ho, doplníme podporu.`,
      raw,
    });
  };

  // export je řazený od NEJNOVĚJŠÍHO → iterace odspodu = chronologicky
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.every((cell) => cell.trim() === '')) continue;
    const line = i + 2; // 1 = hlavička
    const norm = legacy ? normalizeLegacy(row, line) : normalizeV2(row, line);

    if (norm.date === null) {
      result.errors.push({
        line,
        message: `Neplatné datum „${norm.dateRaw}“ (očekáván ${legacy ? 'US formát MM/DD/YYYY s časem' : 'ISO čas, např. 2024-08-16T15:57:13+0200'}).`,
        raw: norm.raw,
      });
      continue;
    }
    if (norm.direction !== null) {
      processTrade(norm);
      continue;
    }
    if (norm.actionRaw !== '') {
      result.errors.push({
        line,
        message: `Neznámý směr obchodu „${norm.actionRaw}“ — nahlaš nám ho, doplníme podporu.`,
        raw: norm.raw,
      });
      continue;
    }
    if (norm.code === 'Receive Deliver') {
      processReceiveDeliver(norm);
      continue;
    }
    if (norm.code === 'Money Movement') {
      processMoneyMovement(norm);
      continue;
    }
    result.errors.push({
      line,
      message: `Neznámý typ řádku „${norm.code}${norm.subType ? ` / ${norm.subType}` : ''}“ — nahlaš nám ho, doplníme podporu.`,
      raw: norm.raw,
    });
  }

  // párování srážek: stejný symbol, nejbližší datum (±5 dní), dividenda bez srážky
  for (const tax of taxes) {
    let best: PendingDividend | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const dividend of dividends) {
      if (dividend.withholding !== undefined || dividend.symbol !== tax.symbol) continue;
      const distance = dayDistance(dividend.date, tax.date);
      if (distance < bestDistance) {
        best = dividend;
        bestDistance = distance;
      }
    }
    if (!best || bestDistance > TAX_MATCH_MAX_DAYS) {
      result.warnings.push({
        line: tax.line,
        message: `Srážková daň ${tax.amount} USD (${tax.symbol || 'bez symbolu'}, ${tax.date}) nemá dohledatelnou dividendu — přiřaď ji přes univerzální šablonu.`,
      });
      continue;
    }
    best.withholding = tax.amount;
  }
  for (const dividend of dividends) {
    push(dividend.line, dividend.raw, {
      type: 'DIVIDEND',
      id: dividend.id,
      isin: dividend.isin,
      ticker: dividend.symbol || undefined,
      gross: dividend.gross,
      currency: dividend.currency,
      withholdingTax: dividend.withholding ?? '0',
      date: dividend.date,
    });
  }

  result.unmappedSymbols = [...unmapped];
  return result;
}

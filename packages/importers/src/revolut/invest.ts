import { d, TransactionSchema } from '@danero/shared';
import { HeaderMap, isValidIsoDate, parseCsv } from '../csv';
import { emptyResult, type ImportResult, type IsinInstrumentMap } from '../types';
import { isIsoCurrency, parseRevolutMoney, REVOLUT_BROKER, revolutIdFactory } from './common';

/**
 * Parser akciového „Account statement“ CSV z Revolutu. Výpis neobsahuje ISIN
 * (jen ticker) — dodává ho mapování symbolů; BUY/SELL bez mapování se
 * neimportuje a ticker skončí v `unmappedSymbols` (vzor XTB). Měna obchodu
 * je ve sloupci Currency, sloupec FX Rate ignorujeme — kurzy počítá engine
 * z kurzů ČNB.
 */
export type RevolutInstrumentMap = IsinInstrumentMap;

/** Hlavička výpisu je stabilně anglická — mapujeme podle přesných názvů sloupců. */
const REQUIRED_HEADERS = [
  'Date',
  'Ticker',
  'Type',
  'Quantity',
  'Price per share',
  'Total Amount',
  'Currency',
] as const;

/** Sloupce, podle kterých akciový výpis poznáme (kombinace je revolut-specifická). */
const SNIFF_HEADERS = ['Date', 'Ticker', 'Type', 'Price per share', 'FX Rate'] as const;

export function sniffRevolutInvestCsv(text: string): boolean {
  if (text.trim() === '') return false;
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const { headers } = parseCsv(firstLine);
  return SNIFF_HEADERS.every((name) => headers.includes(name));
}

type InvestKind =
  | { kind: 'BUY' | 'SELL' }
  | { kind: 'DIVIDEND' }
  | { kind: 'FEE' }
  | { kind: 'SPLIT' }
  | { kind: 'SKIP'; reason: string }
  | { kind: 'UNKNOWN' };

/** Klasifikace řádku podle sloupce Type (hodnoty jsou ve výpisu uppercase). */
function classifyInvestType(type: string): InvestKind {
  if (/^BUY - (MARKET|LIMIT|STOP)$/.test(type)) return { kind: 'BUY' };
  if (/^SELL - (MARKET|LIMIT|STOP)$/.test(type)) return { kind: 'SELL' };
  if (type === 'DIVIDEND') return { kind: 'DIVIDEND' };
  if (type === 'CASH TOP-UP')
    return { kind: 'SKIP', reason: 'vklad hotovosti — pohyb peněz mimo daňový výpočet CP' };
  if (type === 'CASH WITHDRAWAL')
    return { kind: 'SKIP', reason: 'výběr hotovosti — pohyb peněz mimo daňový výpočet CP' };
  if (type === 'CUSTODY FEE REVERSAL')
    return { kind: 'SKIP', reason: 'vratka poplatku za úschovu — do výpočtu nevstupuje' };
  if (type === 'CUSTODY FEE' || type === 'CUSTODY_FEE') return { kind: 'FEE' };
  if (type === 'STOCK SPLIT') return { kind: 'SPLIT' };
  // migrace mezi entitami Revolutu (Trading Ltd → Securities Europe UAB) — není obchod
  if (/^TRANSFER FROM .+ TO .+/.test(type))
    return { kind: 'SKIP', reason: 'převod mezi entitami Revolutu — není obchod, držení pokračuje' };
  return { kind: 'UNKNOWN' };
}

export function parseRevolutInvestCsv(
  text: string,
  instrumentMap: RevolutInstrumentMap = {},
): ImportResult & { unmappedSymbols: string[] } {
  const result = { ...emptyResult(REVOLUT_BROKER), unmappedSymbols: [] as string[] };

  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const { headers, rows } = parseCsv(text);
  const map = new HeaderMap(headers);
  const missing = REQUIRED_HEADERS.filter((name) => !map.has(name));
  if (missing.length > 0) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako akciový výpis Revolutu — chybí sloupce: ${missing.join(', ')}. Nalezené sloupce: ${headers.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }

  const nextId = revolutIdFactory();
  const unmapped = new Set<string>();

  /** ISIN z mapování pro BUY/SELL; bez něj obchod neemitujeme — JEDEN error per ticker. */
  const requireIsin = (ticker: string, line: number): string | null => {
    const instrument = instrumentMap[ticker];
    if (instrument) return instrument.isin;
    if (!unmapped.has(ticker)) {
      unmapped.add(ticker);
      result.errors.push({
        line,
        message: `Symbol ${ticker}: doplň ISIN instrumentu (Revolut ho neexportuje).`,
      });
    }
    return null;
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

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((cell) => cell.trim() === '')) return;
    const raw = row.join(',');

    // ISO 8601 UTC s proměnným počtem desetinných sekund → prvních 10 znaků
    const dateRaw = map.get(row, 'Date');
    const isoDate = dateRaw.slice(0, 10);
    if (!isValidIsoDate(isoDate)) {
      result.errors.push({
        line,
        message: `Neplatné datum „${dateRaw}“ (očekáván ISO 8601 čas, např. 2023-09-22T13:30:10Z).`,
        raw,
      });
      return;
    }

    const type = map.get(row, 'Type').toUpperCase();
    const ticker = map.get(row, 'Ticker');
    const currency = map.get(row, 'Currency');
    const id = nextId(row);
    const classified = classifyInvestType(type);

    switch (classified.kind) {
      case 'BUY':
      case 'SELL': {
        if (ticker === '') {
          result.errors.push({ line, message: `${type}: chybí ticker instrumentu.`, raw });
          return;
        }
        if (!isIsoCurrency(currency)) {
          result.errors.push({
            line,
            message: `${type} ${ticker}: neplatná měna „${currency}“ ve sloupci Currency.`,
            raw,
          });
          return;
        }
        const quantityMoney = parseRevolutMoney(map.get(row, 'Quantity'));
        const quantity = quantityMoney ? d(quantityMoney.amount) : null;
        if (!quantity || quantity.lte(0)) {
          result.errors.push({
            line,
            message: `${type} ${ticker}: chybí kladný počet kusů (Quantity „${map.get(row, 'Quantity')}“).`,
            raw,
          });
          return;
        }
        // Price per share je přesná jednotková cena; Total Amount jen jako
        // fallback (Total/Quantity) — Revolut ho zaokrouhluje
        const priceMoney = parseRevolutMoney(map.get(row, 'Price per share'));
        const totalMoney = parseRevolutMoney(map.get(row, 'Total Amount'));
        const price = priceMoney
          ? d(priceMoney.amount).abs()
          : totalMoney
            ? d(totalMoney.amount).abs().div(quantity)
            : null;
        if (price === null) {
          result.errors.push({
            line,
            message: `${type} ${ticker}: chybí cena (Price per share i Total Amount).`,
            raw,
          });
          return;
        }
        const isin = requireIsin(ticker, line);
        if (isin === null) return; // error per ticker už je nahlášený
        push(line, raw, {
          type: classified.kind,
          id,
          isin,
          ticker,
          quantity: quantity.toString(),
          pricePerShare: price.toString(),
          currency,
          tradeDate: isoDate, // datum vypořádání výpis neobsahuje — dopočte engine
        });
        return;
      }
      case 'DIVIDEND': {
        const totalMoney = parseRevolutMoney(map.get(row, 'Total Amount'));
        const gross = totalMoney ? d(totalMoney.amount) : null;
        if (!gross || gross.lte(0)) {
          result.errors.push({
            line,
            message: `Dividenda ${ticker || 'bez tickeru'}: chybí kladná částka (Total Amount „${map.get(row, 'Total Amount')}“).`,
            raw,
          });
          return;
        }
        if (!isIsoCurrency(currency)) {
          result.errors.push({
            line,
            message: `Dividenda ${ticker}: neplatná měna „${currency}“ ve sloupci Currency.`,
            raw,
          });
          return;
        }
        // ISIN je u dividendy optional — bez mapování ji importujeme jen s tickerem
        push(line, raw, {
          type: 'DIVIDEND',
          id,
          isin: instrumentMap[ticker]?.isin,
          ticker: ticker || undefined,
          gross: gross.toString(),
          currency,
          withholdingTax: '0',
          date: isoDate,
        });
        result.warnings.push({
          line,
          message: `Dividenda ${ticker}: Revolut uvádí dividendy netto po srážce v zahraničí — srážkovou daň výpis neobsahuje; pro přesný zápočet uprav řádek přes univerzální šablonu.`,
        });
        return;
      }
      case 'FEE': {
        const totalMoney = parseRevolutMoney(map.get(row, 'Total Amount'));
        if (!totalMoney) {
          result.errors.push({
            line,
            message: `Poplatek za úschovu: chybí částka (Total Amount „${map.get(row, 'Total Amount')}“).`,
            raw,
          });
          return;
        }
        if (!isIsoCurrency(currency)) {
          result.errors.push({
            line,
            message: `Poplatek za úschovu: neplatná měna „${currency}“ ve sloupci Currency.`,
            raw,
          });
          return;
        }
        // ve výpisu záporný → ukládáme jako kladný náklad
        push(line, raw, {
          type: 'FEE',
          id,
          amount: d(totalMoney.amount).abs().toString(),
          currency,
          date: isoDate,
          note: 'poplatek za úschovu (custody fee)',
        });
        return;
      }
      case 'SPLIT': {
        result.warnings.push({
          line,
          message: `Stock split ${ticker}: výpis neuvádí poměr splitu — doplň korporátní akci přes univerzální šablonu, jinak nebude sedět počet kusů. Řádek přeskočen.`,
        });
        return;
      }
      case 'SKIP': {
        result.skipped.push({ line, message: `„${type}“: ${classified.reason}` });
        return;
      }
      case 'UNKNOWN': {
        result.errors.push({
          line,
          message: `Neznámý typ řádku „${type}“ — nahlaš nám ho, doplníme podporu.`,
          raw,
        });
        return;
      }
    }
  });

  result.unmappedSymbols = [...unmapped];
  return result;
}

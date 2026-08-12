import { d, TransactionSchema, type Decimal } from '@danero/shared';
import { HeaderMap, isValidIsoDate, parseCsv } from '../csv';
import { emptyResult, type ImportResult } from '../types';
import {
  detectRevolutDecimal,
  isIsoCurrency,
  parseRevolutMoney,
  type RevolutMoney,
  REVOLUT_BROKER,
  revolutAmbiguityNote,
  revolutIdFactory,
} from './common';

/**
 * Parser krypto výpisů Revolutu — dva historické formáty:
 *
 * 1. nový (2023+): `Symbol,Type,Quantity,Price,Value,Fees,Date` — peněžní
 *    hodnoty se symbolem/kódem měny uvnitř, datum anglicky „Jun 12, 2018, …“;
 * 2. starý (do ~2022/23): 13 sloupců s `Started Date`/`Completed Date`,
 *    krypto symbol ve sloupci Currency a fiat měnou v Base currency.
 *
 * Krypto↔krypto směna je ve výpisu pár řádků Sell+Buy se stejným časem —
 * parser nic párovat nemusí, každý řádek stojí sám: Sell prodávaného aktiva
 * je oceněný fiat hodnotou protiplnění a Buy kupovaného taky (kanonický tvar
 * směny podle universal šablony: SELL oceněný protiplněním + BUY kupovaného).
 */

export const REVOLUT_CRYPTO_COLUMNS = ['Symbol', 'Type', 'Quantity', 'Price', 'Value', 'Fees', 'Date'] as const;
const OLD_SNIFF_HEADERS = ['Started Date', 'Completed Date', 'Base currency', 'Fiat amount'] as const;

type CryptoFormat = 'new' | 'old';

function detectCryptoFormat(headers: string[]): CryptoFormat | null {
  // Nový formát: všech sedm sloupců JE v hlavičce — na pořadí ani na sloupci
  // navíc nezáleží (parser čte podle názvů). Porovnání na přesnou délku
  // a pořadí znamenalo, že jediný přidaný sloupec import zabil a uživatel
  // dostal hlášku univerzální šablony o nečitelném datu.
  if (REVOLUT_CRYPTO_COLUMNS.every((name) => headers.includes(name))) return 'new';
  if (OLD_SNIFF_HEADERS.every((name) => headers.includes(name))) return 'old';
  return null;
}

export function sniffRevolutCryptoCsv(text: string): boolean {
  if (text.trim() === '') return false;
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  return detectCryptoFormat(parseCsv(firstLine).headers) !== null;
}

export function parseRevolutCryptoCsv(text: string): ImportResult {
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return emptyResult(REVOLUT_BROKER);
  const { headers, rows } = parseCsv(text);
  return parseRevolutCryptoTable(headers, rows);
}

/** Jádro parseru nad tabulkou — sdílí ho CSV i XLSX větev (viz invest.ts). */
export function parseRevolutCryptoTable(headers: string[], rows: string[][]): ImportResult {
  const result = emptyResult(REVOLUT_BROKER);
  // lokalizace čísel se pozná z celého souboru, ne z jedné buňky (B-3-12)
  const decimal = detectRevolutDecimal(rows);
  const format = detectCryptoFormat(headers);
  if (format === null) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako krypto výpis Revolutu — očekávám sloupce „${REVOLUT_CRYPTO_COLUMNS.join(', ')}“ (nový formát), nebo „${OLD_SNIFF_HEADERS.join(', ')}“ (starší formát). Nalezené sloupce: ${headers.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }

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

  if (format === 'new') parseNewFormat(headers, rows, result, push, decimal);
  else parseOldFormat(headers, rows, result, push);
  return result;
}

type PushFn = (line: number, raw: string, candidate: Record<string, unknown>) => void;
/** Desetinný oddělovač souboru; null = výpis ho neprozradil (viz varování). */
type DecimalSeparator = ',' | '.' | null;

/* ── Nový formát (2023+): Symbol,Type,Quantity,Price,Value,Fees,Date ─────── */

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** „Jun 12, 2018, 4:16:32 PM“ → „2018-06-12“; čas se zahazuje. */
function parseEnglishDate(value: string): string | null {
  const match = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[match[1]!.toLowerCase()];
  if (month === undefined) return null;
  const iso = `${match[3]}-${month}-${match[2]!.padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

type CryptoKind =
  | { kind: 'BUY' | 'SELL'; note?: string }
  | { kind: 'SKIP'; reason: string }
  | { kind: 'WARN_SKIP'; reason: string }
  | { kind: 'UNKNOWN' };

/** Klasifikace řádku nového formátu podle sloupce Type. */
function classifyCryptoType(type: string): CryptoKind {
  switch (type.toLowerCase()) {
    case 'buy':
      return { kind: 'BUY' };
    case 'sell':
      return { kind: 'SELL' };
    case 'payment':
      return { kind: 'SELL', note: 'platba kryptem = úplatný převod (zdanitelný)' };
    case 'send':
    case 'receive':
      return {
        kind: 'SKIP',
        reason:
          'převod na/z vlastní peněženky — bez daňové události; pokud šlo o dar či platbu, doplň přes univerzální šablonu',
      };
    case 'stake':
    case 'unstake':
      return { kind: 'SKIP', reason: 'přesun do/ze stakingu — bez daňové události' };
    case 'staking reward':
    case 'learn reward':
      return {
        kind: 'WARN_SKIP',
        reason: 'daňové zařazení odměn zatím nepodporujeme — řádek přeskočen',
      };
    case 'other':
      return {
        kind: 'WARN_SKIP',
        reason: 'typ „Other“ neumíme daňově zařadit — řádek přeskočen, zkontroluj ho ve výpisu',
      };
    default:
      return { kind: 'UNKNOWN' };
  }
}

function parseNewFormat(
  headers: string[],
  rows: string[][],
  result: ImportResult,
  push: PushFn,
  decimal: DecimalSeparator,
): void {
  const map = new HeaderMap(headers);
  const money = (value: string): RevolutMoney | null => parseRevolutMoney(value, decimal);
  const nextId = revolutIdFactory();

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((cell) => cell.trim() === '')) return;
    const raw = row.join(',');

    const type = map.get(row, 'Type');
    const symbol = map.get(row, 'Symbol');
    const classified = classifyCryptoType(type);

    if (classified.kind === 'SKIP') {
      result.skipped.push({ line, message: `${symbol} „${type}“: ${classified.reason}` });
      return;
    }
    if (classified.kind === 'WARN_SKIP') {
      result.warnings.push({ line, message: `${symbol} „${type}“: ${classified.reason}` });
      return;
    }
    if (classified.kind === 'UNKNOWN') {
      result.errors.push({
        line,
        message: `Neznámý typ řádku „${type}“ — nahlaš nám ho, doplníme podporu.`,
        raw,
      });
      return;
    }

    const isoDate = parseEnglishDate(map.get(row, 'Date'));
    if (isoDate === null) {
      result.errors.push({
        line,
        message: `Neplatné datum „${map.get(row, 'Date')}“ (očekáván formát „Jun 12, 2018, 4:16:32 PM“).`,
        raw,
      });
      return;
    }
    if (symbol === '') {
      result.errors.push({ line, message: `${type}: chybí symbol kryptoaktiva.`, raw });
      return;
    }
    const quantityMoney = money(map.get(row, 'Quantity'));
    const quantity = quantityMoney ? d(quantityMoney.amount).abs() : null;
    if (decimal === null && quantity !== null) {
      const note = revolutAmbiguityNote('Množství', map.get(row, 'Quantity'), quantity.toString());
      if (note !== null) result.warnings.push({ line, message: note });
    }
    if (!quantity || quantity.lte(0)) {
      result.errors.push({
        line,
        message: `${type} ${symbol}: chybí kladné množství (Quantity „${map.get(row, 'Quantity')}“).`,
        raw,
      });
      return;
    }

    // Price = jednotková cena ve fiat, Value = celkem; měnu určuje symbol/kód
    // uvnitř hodnoty (€ → EUR, $ → USD, £ → GBP, „137,211.36 SEK“ → SEK)
    const priceMoney = money(map.get(row, 'Price'));
    const valueMoney = money(map.get(row, 'Value'));
    const currency = priceMoney?.currency ?? valueMoney?.currency ?? null;
    if (currency === null || !isIsoCurrency(currency)) {
      result.errors.push({
        line,
        message: `${type} ${symbol}: z hodnot „${map.get(row, 'Price')}“ / „${map.get(row, 'Value')}“ se nepodařilo určit měnu.`,
        raw,
      });
      return;
    }
    const price: Decimal | null = priceMoney
      ? d(priceMoney.amount).abs()
      : valueMoney
        ? d(valueMoney.amount).abs().div(quantity)
        : null;
    if (price === null) {
      result.errors.push({
        line,
        message: `${type} ${symbol}: chybí cena (Price i Value).`,
        raw,
      });
      return;
    }

    // poplatek zvlášť ze sloupce Fees; nulový se neukládá
    const feesMoney = money(map.get(row, 'Fees'));
    const feeAmount = feesMoney ? d(feesMoney.amount).abs() : null;
    const fee =
      feeAmount && feeAmount.gt(0)
        ? { amount: feeAmount.toString(), currency: feesMoney?.currency ?? currency }
        : undefined;

    push(line, raw, {
      type: classified.kind,
      id: nextId(row),
      isin: symbol, // krypto: isin = symbol (kanonický model)
      ticker: symbol,
      assetClass: 'CRYPTO',
      quantity: quantity.toString(),
      pricePerShare: price.toString(),
      currency,
      fee,
      tradeDate: isoDate,
      note: classified.note,
    });
  });
}

/* ── Starý formát (do ~2022/23): 13 sloupců, čísla čistě s tečkou ────────── */

const OLD_REQUIRED_HEADERS = [
  'Type',
  'Completed Date',
  'Description',
  'Amount',
  'Currency',
  'Fiat amount',
  'Fee',
  'Base currency',
  'State',
] as const;

/** Čísla starého formátu jsou čistě s desetinnou tečkou — žádná lokalizace. */
function parsePlainNumber(value: string): Decimal | null {
  const trimmed = value.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? d(trimmed) : null;
}

function parseOldFormat(headers: string[], rows: string[][], result: ImportResult, push: PushFn): void {
  // starší formát má čísla vždy s desetinnou tečkou (parseOldNumber), takže
  // lokalizaci souboru tady řešit netřeba
  const map = new HeaderMap(headers);
  const missing = OLD_REQUIRED_HEADERS.filter((name) => !map.has(name));
  if (missing.length > 0) {
    result.errors.push({
      line: 1,
      message: `Krypto výpis (starší formát) — chybí sloupce: ${missing.join(', ')}.`,
    });
    return;
  }
  const nextId = revolutIdFactory();

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((cell) => cell.trim() === '')) return;
    const raw = row.join(',');

    const state = map.get(row, 'State').toUpperCase();
    if (state !== 'COMPLETED') {
      result.skipped.push({
        line,
        message: `Stav „${state}“ — transakce neproběhla, importují se jen dokončené (COMPLETED).`,
      });
      return;
    }

    const description = map.get(row, 'Description');
    const lowerDescription = description.toLowerCase();
    if (lowerDescription.includes('balance migration')) {
      result.skipped.push({
        line,
        message: `„${description}“: migrace zůstatku mezi entitami Revolutu — není obchod, držení pokračuje.`,
      });
      return;
    }
    if (lowerDescription.includes('closing transaction')) {
      result.skipped.push({
        line,
        message: `„${description}“: technický uzavírací řádek — není obchod.`,
      });
      return;
    }

    const type = map.get(row, 'Type').toUpperCase();
    if (type !== 'EXCHANGE' && type !== 'CARD_PAYMENT') {
      result.warnings.push({
        line,
        message: `Typ „${type}“ (${description || 'bez popisu'}) zatím nepodporujeme — řádek přeskočen; pokud jde o zdanitelnou událost, doplň ji přes univerzální šablonu.`,
      });
      return;
    }

    // Completed Date „2021-06-04 7:27:08“ → prvních 10 znaků
    const dateRaw = map.get(row, 'Completed Date');
    const isoDate = dateRaw.slice(0, 10);
    if (!isValidIsoDate(isoDate)) {
      result.errors.push({
        line,
        message: `Neplatné datum „${dateRaw}“ (očekáván formát YYYY-MM-DD HH:mm:ss).`,
        raw,
      });
      return;
    }

    const symbol = map.get(row, 'Currency'); // Currency = krypto symbol
    const baseCurrency = map.get(row, 'Base currency'); // fiat měna
    if (symbol === '') {
      result.errors.push({ line, message: `${type}: chybí symbol kryptoaktiva.`, raw });
      return;
    }
    if (!isIsoCurrency(baseCurrency)) {
      result.errors.push({
        line,
        message: `${type} ${symbol}: neplatná fiat měna „${baseCurrency}“ ve sloupci Base currency.`,
        raw,
      });
      return;
    }

    const amount = parsePlainNumber(map.get(row, 'Amount'));
    const fiat = parsePlainNumber(map.get(row, 'Fiat amount'));
    if (amount === null || amount.eq(0) || fiat === null) {
      result.errors.push({
        line,
        message: `${type} ${symbol}: chybí množství nebo fiat hodnota (Amount „${map.get(row, 'Amount')}“, Fiat amount „${map.get(row, 'Fiat amount')}“).`,
        raw,
      });
      return;
    }

    let txType: 'BUY' | 'SELL';
    let note: string | undefined;
    if (type === 'EXCHANGE') {
      // kladný Amount = nákup kryptoaktiva, záporný = prodej
      txType = amount.gt(0) ? 'BUY' : 'SELL';
    } else {
      if (amount.gte(0)) {
        result.warnings.push({
          line,
          message: `Platba kartou s kladným množstvím ${amount.toString()} ${symbol} — vypadá jako vratka, neumíme ji daňově zařadit; řádek přeskočen, zkontroluj ho ve výpisu.`,
        });
        return;
      }
      txType = 'SELL';
      note = 'platba kryptem = úplatný převod (zdanitelný)';
    }

    const quantity = amount.abs();
    const feeRaw = parsePlainNumber(map.get(row, 'Fee'));
    const fee =
      feeRaw && feeRaw.abs().gt(0)
        ? { amount: feeRaw.abs().toString(), currency: baseCurrency }
        : undefined;

    push(line, raw, {
      type: txType,
      id: nextId(row),
      isin: symbol, // krypto: isin = symbol (kanonický model)
      ticker: symbol,
      assetClass: 'CRYPTO',
      quantity: quantity.toString(),
      // celková cena = |Fiat amount| (bez poplatku), jednotková dopočtená Decimalem
      pricePerShare: fiat.abs().div(quantity).toString(),
      currency: baseCurrency,
      fee,
      tradeDate: isoDate,
      note,
    });
  });
}

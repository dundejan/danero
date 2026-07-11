import { d, TransactionSchema } from '@danero/shared';
import { normalizeHeader, parseCsv, parseEuroDate } from '../csv';
import { fnv1a64, uniqueIdFactory } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const COINMATE_BROKER = 'coinmate';

/**
 * Parser výpisů Coinmate (česká krypto burza). CSV se středníkem, UTF-8
 * (může mít BOM), hlavičky česky NEBO anglicky podle jazyka účtu — tři
 * varianty transakční historie (EN krátká, EN dlouhá se zůstatky, CZ) plus
 * „account statement" V2, kde je měna v pojmenovaném sloupci PŘED hodnotou
 * (Currency amount;Amount) a směr obchodu nese sloupec Type detail.
 *
 * Čísla jsou vždy s desetinnou tečkou (i v CZ exportu), prázdné hodnoty bývají
 * jediná mezera. Datum `yyyy-MM-dd HH:mm:ss` nebo česky `16.08.2021 9:42`.
 * Obchoduje se výhradně pár krypto–fiat: Částka = krypto, Cena = fiat za kus.
 */

/* ── Hlavičky (CZ/EN/V2 synonyma, přes normalizeHeader) ─────────────────── */

const HEADER_SYNONYMS = {
  id: ['id', 'transaction id'],
  date: ['date', 'datum'],
  type: ['type', 'typ'],
  typeDetail: ['type detail'],
  amount: ['amount', 'castka'],
  amountCurrency: ['amount currency', 'castka meny', 'currency amount'],
  price: ['price', 'cena'],
  priceCurrency: ['price currency', 'cena meny', 'currency price'],
  fee: ['fee', 'poplatek'],
  feeCurrency: ['fee currency', 'poplatek meny', 'currency fee'],
  total: ['total', 'celkem'],
  totalCurrency: ['total currency', 'celkem meny', 'currency total'],
  description: ['description', 'popisek'],
  status: ['status'],
} satisfies Record<string, string[]>;

type ColumnKey = keyof typeof HEADER_SYNONYMS;

function mapColumns(headers: string[]): Record<ColumnKey, number> {
  const index = new Map<string, number>();
  headers.forEach((header, i) => {
    const normalized = normalizeHeader(header);
    if (!index.has(normalized)) index.set(normalized, i);
  });
  const columns = {} as Record<ColumnKey, number>;
  for (const key of Object.keys(HEADER_SYNONYMS) as ColumnKey[]) {
    columns[key] = -1;
    for (const synonym of HEADER_SYNONYMS[key]) {
      const i = index.get(synonym);
      if (i !== undefined) {
        columns[key] = i;
        break;
      }
    }
  }
  return columns;
}

/* ── Pomůcky ────────────────────────────────────────────────────────────── */

const cell = (row: string[], index: number): string =>
  index >= 0 ? (row[index] ?? '').trim() : '';

/** Coinmate píše čísla vždy s desetinnou tečkou; prázdno bývá mezera → null. */
const parseNumber = (value: string): string | null =>
  /^-?\d+(\.\d+)?$/.test(value) ? value : null;

const isFiatCode = (value: string): boolean => /^[A-Z]{3}$/.test(value);

/** Typy transakcí podle směru; ostatní se přeskakují nebo hlásí. */
const BUY_TYPES = new Set(['BUY', 'QUICK_BUY', 'MARKET_BUY']);
const SELL_TYPES = new Set(['SELL', 'QUICK_SELL', 'MARKET_SELL']);
const TRANSFER_TYPES = new Set(['DEPOSIT', 'WITHDRAWAL']);
const BALANCE_MOVE_TYPES = new Set(['BALANCE_MOVE_CREDIT', 'BALANCE_MOVE_DEBIT']);
const AFFILIATE_TYPES = new Set(['AFFILIATE', 'REFERRAL']);
/** V2 statement: Type = Trade/Quick trade, směr je ve sloupci Type detail. */
const TRADE_WRAPPER_TYPES = new Set(['TRADE', 'QUICK TRADE']);


/* ── Autodetekce ────────────────────────────────────────────────────────── */

/**
 * Detekce Coinmate CSV z první řádky: středníky + dvojice měnových sloupců
 * v některé z variant (EN, CZ, V2). Kombinace „Amount Currency" + „Price
 * Currency" (resp. CZ/V2 ekvivalenty) se v jiných podporovaných formátech
 * nevyskytuje — T212 má čárky a „Currency (Price / share)", Degiro nemá
 * měnové sloupce pojmenované, univerzální šablona má čárky.
 */
export function sniffCoinmateCsv(text: string): boolean {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const newline = input.indexOf('\n');
  const firstLine = normalizeHeader(newline === -1 ? input : input.slice(0, newline));
  if (!firstLine.includes(';')) return false;
  return (
    (firstLine.includes('amount currency') && firstLine.includes('price currency')) ||
    (firstLine.includes('castka meny') && firstLine.includes('cena meny')) ||
    (firstLine.includes('currency amount') && firstLine.includes('currency price'))
  );
}

/* ── Parser ─────────────────────────────────────────────────────────────── */

export function parseCoinmateCsv(text: string): ImportResult {
  const result = emptyResult(COINMATE_BROKER);
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const { headers, rows } = parseCsv(text, ';');
  const col = mapColumns(headers);

  const missing = (['date', 'type', 'amount', 'amountCurrency', 'priceCurrency', 'status'] as const)
    .filter((key) => col[key] < 0);
  if (missing.length > 0) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako výpis Coinmate — chybí sloupce pro datum, typ, částku, měny a stav. Nalezené sloupce: ${headers.filter((h) => h.trim() !== '').join(', ')}`,
    });
    return result;
  }

  const nextId = uniqueIdFactory();

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((c) => c.trim() === '')) return;

    // jen dokončené transakce — zrušené/čekající nemají daňový dopad
    const status = cell(row, col.status).toUpperCase();
    if (status !== 'OK' && status !== 'COMPLETED') {
      result.skipped.push({
        line,
        message: `Transakce se stavem „${cell(row, col.status)}" — zpracováváme jen dokončené (OK/COMPLETED).`,
      });
      return;
    }

    const description = cell(row, col.description);
    let type = cell(row, col.type).toUpperCase();

    // V2 statement: Trade/Quick trade + Type detail BUY/SELL/QUICK_*/CANCEL
    if (TRADE_WRAPPER_TYPES.has(type)) {
      const detail = cell(row, col.typeDetail).toUpperCase();
      if (detail === 'CANCEL') {
        result.skipped.push({ line, message: 'Zrušený obchod — bez daňového dopadu.' });
        return;
      }
      if (detail === '') {
        result.errors.push({
          line,
          message: 'Obchod bez upřesnění směru (sloupec Type detail je prázdný) — řádek nejde zpracovat.',
          raw: row.join(';'),
        });
        return;
      }
      type = detail;
    }

    // odměny z affiliate programu — i řádky s prázdným typem a popiskem „User: …"
    if (AFFILIATE_TYPES.has(type) || (type === '' && description.startsWith('User:'))) {
      result.warnings.push({
        line,
        message:
          'Odměny z affiliate programu zatím daňově nezařazujeme — řádek jsme přeskočili. Pokud jsou částky významné, doplň je přes univerzální šablonu jako ostatní příjem.',
      });
      return;
    }

    if (TRANSFER_TYPES.has(type)) {
      result.skipped.push({
        line,
        message: `${type === 'DEPOSIT' ? 'Vklad' : 'Výběr'} ${cell(row, col.amount)} ${cell(row, col.amountCurrency)} — převod prostředků není zdanitelná událost.`,
      });
      return;
    }

    if (BALANCE_MOVE_TYPES.has(type)) {
      result.skipped.push({
        line,
        message: 'Interní přesun zůstatku mezi účty Coinmate — bez daňového dopadu.',
      });
      return;
    }

    if (!BUY_TYPES.has(type) && !SELL_TYPES.has(type)) {
      result.errors.push({
        line,
        message: `Neznámý typ transakce „${cell(row, col.type) || 'prázdno'}" — nahlaš nám ho, doplníme podporu.`,
        raw: row.join(';'),
      });
      return;
    }

    /* ── BUY / SELL ── */

    const isoDate = parseEuroDate(cell(row, col.date));
    if (!isoDate) {
      result.errors.push({
        line,
        message: `Neplatné datum „${cell(row, col.date)}" (očekáváme yyyy-MM-dd HH:mm:ss nebo dd.mm.yyyy).`,
        raw: row.join(';'),
      });
      return;
    }

    const amountRaw = parseNumber(cell(row, col.amount));
    const priceRaw = parseNumber(cell(row, col.price));
    const symbol = cell(row, col.amountCurrency);
    const currency = cell(row, col.priceCurrency);

    if (amountRaw === null || d(amountRaw).eq(0) || priceRaw === null || symbol === '') {
      result.errors.push({
        line,
        message: 'Obchodu chybí množství kryptoměny, cena nebo symbol — řádek nelze zpracovat.',
        raw: row.join(';'),
      });
      return;
    }
    if (!isFiatCode(currency)) {
      result.errors.push({
        line,
        message: `Měna ceny „${currency || 'prázdno'}" není třípísmenný kód — řádek nelze zpracovat.`,
        raw: row.join(';'),
      });
      return;
    }

    // poplatek: v samostatném sloupci, u obchodů ve fiat měně; nula/prázdno = bez poplatku
    let fee: { amount: string; currency: string } | undefined;
    const feeRaw = parseNumber(cell(row, col.fee));
    if (feeRaw !== null && !d(feeRaw).eq(0)) {
      const feeCurrency = cell(row, col.feeCurrency);
      if (isFiatCode(feeCurrency)) {
        fee = { amount: d(feeRaw).abs().toString(), currency: feeCurrency };
      } else {
        result.warnings.push({
          line,
          message: `Poplatek ${feeRaw} má měnu „${feeCurrency || 'prázdno'}", kterou neumíme zapsat — nebyl započten, zkontroluj ho ručně.`,
        });
      }
    }

    const rawId = cell(row, col.id);
    const id = nextId(
      rawId !== ''
        ? `coinmate-${rawId}`
        : `coinmate-${fnv1a64([isoDate, type, amountRaw, symbol, priceRaw, currency].join('|'))}`,
    );

    try {
      result.transactions.push(
        TransactionSchema.parse({
          type: BUY_TYPES.has(type) ? 'BUY' : 'SELL',
          id,
          isin: symbol, // krypto: isin = symbol (BTC, LTC…)
          ticker: symbol,
          assetClass: 'CRYPTO',
          quantity: d(amountRaw).abs(),
          pricePerShare: d(priceRaw).abs(),
          currency,
          fee,
          tradeDate: isoDate,
        }),
      );
    } catch (err) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw: row.join(';'),
      });
    }
  });

  return result;
}

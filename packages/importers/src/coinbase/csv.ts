import { d, TransactionSchema } from '@danero/shared';
import { cleanNumber, HeaderMap, isValidIsoDate, normalizeHeader, parseCsv } from '../csv';
import { fnv1a64, uniqueIdFactory } from '../dedupe';
import { emptyResult, type ImportResult, type RowIssue } from '../types';

export const COINBASE_BROKER = 'coinbase';

/**
 * Parser Coinbase „transaction history" CSV. Čtyři generace hlaviček (mapování
 * VÝHRADNĚ podle názvů):
 *  - V4: `ID,Timestamp,…,Price Currency,Price at Transaction,…,Fees and/or Spread,Notes`
 *  - V3: bez ID, `Spot Price Currency,Spot Price at Transaction,…`
 *  - V2: `…,Total (inclusive of fees),Fees,…`
 *  - V1: měnový prefix ve jménech sloupců (`EUR Subtotal`, `EUR Fees`…)
 * Starší soubory mívají před hlavičkou preambuli → hlavička se hledá jako řádek
 * začínající `Timestamp,` nebo `ID,Timestamp`. Částky mohou nést symbol měny
 * a tisícové čárky (`€6.65`, `1,234.56`) — očistí se.
 */

/* ── Klasifikace typů (kompletní slovník, lowercase) ─────────────────────── */

const BUY_TYPES = new Set(['buy', 'advanced trade buy', 'advance trade buy']);
const SELL_TYPES = new Set(['sell', 'advanced trade sell', 'advance trade sell']);

/** Převody a interní pohyby — vědomě přeskočeno bez varování. */
const SILENT_SKIP_TYPES = new Set([
  'send',
  'receive',
  'deposit',
  'withdrawal',
  'exchange deposit',
  'exchange withdrawal',
  'pro deposit',
  'pro withdrawal',
  'prime deposit',
  'transfer',
  'retail staking transfer',
  'retail unstaking transfer',
  'vault withdrawal',
  'cash to savings',
  'savings to cash',
  'asset migration',
]);

/** Odměny (staking, earn, úroky…) — zatím daňově nezařazujeme → warning + skip. */
const REWARD_TYPES = new Set([
  'coinbase earn',
  'learning reward',
  'rewards income',
  'reward income',
  'inflation reward',
  'staking income',
  'interest payout',
]);

/** Ostatní známé, ale nepodporované typy → warning + skip s názvem typu. */
const WARN_SKIP_TYPES = new Set([
  'subscription rebate',
  'subscription rebates (24 hours)',
  'credit',
  'donation',
  'admin debit',
  'subscription',
  'retail eth2 deprecation',
  'retail simple dust',
  'retail mgx dex buy',
  'retail mgx dex send',
]);

/* ── Pomocníci ───────────────────────────────────────────────────────────── */

/** Očistí částku od symbolu měny a tisícových čárek: `€6.65` → `6.65`, `1,234.56` → `1234.56`. */
function cleanCoinbaseNumber(value: string): string | null {
  const stripped = value.replace(/[^\d.,-]/g, '');
  if (stripped === '') return null;
  const cleaned = cleanNumber(stripped);
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : null;
}

/** Timestamp ISO `…Z` NEBO `YYYY-MM-DD HH:MM:SS UTC` → prvních 10 znaků = datum. */
function toIsoDate(timestamp: string): string | null {
  const iso = timestamp.trim().slice(0, 10);
  return isValidIsoDate(iso) ? iso : null;
}


/** Notes u Convert: „Converted 0.05413984 BTC to 451.212148 USDC". */
const CONVERT_NOTES = /^Converted [\d.,]+ \S+ to ([\d.,]+) (\S+)$/;

/* ── Sniff ───────────────────────────────────────────────────────────────── */

/** Detekce Coinbase CSV: v prvních ~5 řádcích je hlavička s Transaction Type + Quantity Transacted. */
export function sniffCoinbaseCsv(text: string): boolean {
  return text
    .split(/\r?\n/)
    .slice(0, 5)
    .some((line) => line.includes('Transaction Type') && line.includes('Quantity Transacted'));
}

/* ── Parser ──────────────────────────────────────────────────────────────── */

export function parseCoinbaseCsv(text: string): ImportResult {
  const result = emptyResult(COINBASE_BROKER);
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  // starší exporty mají před hlavičkou preambuli → najdi řádek s hlavičkou
  const lines = input.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    /^"?(?:ID"?,"?)?Timestamp"?,/.test(line.trim()),
  );
  if (headerIndex === -1) {
    result.errors.push({
      line: 1,
      message:
        'Soubor nevypadá jako Coinbase export — nenašli jsme hlavičku začínající „Timestamp" nebo „ID,Timestamp".',
    });
    return result;
  }

  const { headers: rawHeaders, rows } = parseCsv(lines.slice(headerIndex).join('\n'));
  const headers = rawHeaders.map(normalizeHeader);
  const map = new HeaderMap(headers);
  const headerLine = headerIndex + 1; // 1-based číslo řádku hlavičky v souboru

  // V1: měnový prefix ve jménech sloupců („EUR Subtotal") — prefix = kód měny
  const prefix = headers
    .map((h) => /^([a-z]{3}) subtotal$/.exec(h)?.[1])
    .find((p) => p !== undefined);

  /** První existující sloupec ze synonym dané generace exportu. */
  const resolve = (...names: string[]): string | null =>
    names.find((name) => map.has(name)) ?? null;

  const col = {
    id: resolve('id'),
    timestamp: resolve('timestamp'),
    type: resolve('transaction type'),
    asset: resolve('asset'),
    quantity: resolve('quantity transacted'),
    currency: resolve('price currency', 'spot price currency'),
    subtotal: resolve('subtotal', ...(prefix ? [`${prefix} subtotal`] : [])),
    fees: resolve(
      'fees and/or spread',
      'fees',
      ...(prefix ? [`${prefix} fees`, `${prefix} fees and/or spread`] : []),
    ),
    notes: resolve('notes'),
  };

  if (!col.timestamp || !col.type || !col.asset || !col.quantity || !col.subtotal) {
    result.errors.push({
      line: headerLine,
      message: `Soubor nevypadá jako Coinbase export — chybí sloupce Timestamp/Transaction Type/Asset/Quantity Transacted/Subtotal. Nalezené sloupce: ${rawHeaders.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }
  if (!col.currency && !prefix) {
    result.errors.push({
      line: headerLine,
      message:
        'Soubor nevypadá jako Coinbase export — nenašli jsme měnu (sloupec „Price Currency"/„Spot Price Currency" ani měnový prefix názvů sloupců).',
    });
    return result;
  }

  const nextId = uniqueIdFactory();

  rows.forEach((row, rowIndex) => {
    const line = headerLine + rowIndex + 1;
    if (row.every((cell) => cell.trim() === '')) return;

    const get = (name: string | null): string => (name === null ? '' : map.get(row, name));
    const raw = row.join(',');
    const typeRaw = get(col.type);
    const type = typeRaw.trim().toLowerCase();
    const asset = get(col.asset).trim().toUpperCase();

    if (SILENT_SKIP_TYPES.has(type)) {
      result.skipped.push({
        line,
        message: `${typeRaw} (${asset}) — převod či interní pohyb, ne zdanitelná událost.`,
      });
      return;
    }
    if (REWARD_TYPES.has(type)) {
      result.warnings.push({
        line,
        message: `${typeRaw} (${asset}) — odměny zatím daňově nezařazujeme, řádek přeskočen.`,
        raw,
      });
      return;
    }
    if (WARN_SKIP_TYPES.has(type)) {
      result.warnings.push({
        line,
        message: `Typ „${typeRaw}" zatím nepodporujeme — řádek přeskočen. Pokud jde o zdanitelnou událost, doplň ji přes univerzální šablonu.`,
        raw,
      });
      return;
    }

    const isBuy = BUY_TYPES.has(type);
    const isSell = SELL_TYPES.has(type);
    const isConvert = type === 'convert';
    const isCardSpend = type === 'card spend';
    if (!isBuy && !isSell && !isConvert && !isCardSpend) {
      result.errors.push({
        line,
        message: `Neznámý typ transakce „${typeRaw}" — nahlaš nám ho, doplníme podporu.`,
        raw,
      });
      return;
    }

    // společné náležitosti obchodních řádků
    const date = toIsoDate(get(col.timestamp));
    if (date === null) {
      result.errors.push({
        line,
        message: `Neplatný čas „${get(col.timestamp)}" (očekáváme ISO datum, např. 2024-12-19T17:59:59Z).`,
        raw,
      });
      return;
    }
    const currency = (prefix ? prefix.toUpperCase() : get(col.currency).trim().toUpperCase());
    if (!/^[A-Z]{3}$/.test(currency)) {
      result.errors.push({
        line,
        message: `Měnu se nepodařilo přečíst — nalezeno „${currency}", očekáváme třípísmenný kód (EUR, USD…).`,
        raw,
      });
      return;
    }
    const quantityRaw = cleanCoinbaseNumber(get(col.quantity));
    const subtotalRaw = cleanCoinbaseNumber(get(col.subtotal));
    if (quantityRaw === null || asset === '') {
      result.errors.push({
        line,
        message: `${typeRaw}: chybí aktivum nebo počet kusů — řádek nelze zpracovat.`,
        raw,
      });
      return;
    }
    if (subtotalRaw === null) {
      result.errors.push({
        line,
        message: `${typeRaw}: chybí částka (Subtotal) — nelze spočítat cenu, řádek nelze zpracovat.`,
        raw,
      });
      return;
    }
    const quantity = d(quantityRaw).abs(); // Sell mívá záporný počet kusů
    if (quantity.eq(0)) {
      result.errors.push({
        line,
        message: `${typeRaw}: nulový počet kusů — řádek nelze zpracovat.`,
        raw,
      });
      return;
    }
    const subtotal = d(subtotalRaw).abs();
    const feeRaw = cleanCoinbaseNumber(get(col.fees));
    const feeAmount = feeRaw === null ? null : d(feeRaw).abs();
    const fee =
      feeAmount !== null && feeAmount.gt(0)
        ? { amount: feeAmount.toString(), currency }
        : undefined;

    const explicitId = get(col.id);
    const baseId = nextId(
      explicitId !== '' ? `coinbase-${explicitId}` : `coinbase-${fnv1a64(raw)}`,
    );

    const push = (candidate: Record<string, unknown>): void => {
      try {
        result.transactions.push(TransactionSchema.parse(candidate));
      } catch (err) {
        result.errors.push({
          line,
          message: `Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
          raw,
        } satisfies RowIssue);
      }
    };

    if (isConvert) {
      // Convert = jeden řádek: prodej Assetu + nákup cílového aktiva z Notes
      const notes = get(col.notes).trim();
      const match = CONVERT_NOTES.exec(notes);
      const targetQuantityRaw = match ? cleanCoinbaseNumber(match[1]!) : null;
      if (!match || targetQuantityRaw === null || d(targetQuantityRaw).eq(0)) {
        result.errors.push({
          line,
          message: `Convert bez čitelné poznámky („${notes}") — nepoznáme cílové aktivum a počet kusů, směnu doplň přes univerzální šablonu jako prodej + nákup.`,
          raw,
        });
        return;
      }
      const targetQuantity = d(targetQuantityRaw);
      push({
        type: 'SELL',
        id: `${baseId}-sell`,
        isin: asset,
        assetClass: 'CRYPTO',
        quantity: quantity.toString(),
        pricePerShare: subtotal.div(quantity).toString(),
        currency,
        fee,
        tradeDate: date,
        note: notes,
      });
      push({
        type: 'BUY',
        id: `${baseId}-buy`,
        isin: match[2]!.toUpperCase(),
        assetClass: 'CRYPTO',
        quantity: targetQuantity.toString(),
        pricePerShare: subtotal.div(targetQuantity).toString(),
        currency,
        tradeDate: date,
        note: notes,
      });
      return;
    }

    push({
      type: isBuy ? 'BUY' : 'SELL', // Card Spend = prodej (úplatný převod)
      id: baseId,
      isin: asset,
      assetClass: 'CRYPTO',
      quantity: quantity.toString(),
      pricePerShare: subtotal.div(quantity).toString(),
      currency,
      fee,
      tradeDate: date,
      ...(isCardSpend ? { note: 'platba kartou = úplatný převod' } : {}),
    });
  });

  return result;
}

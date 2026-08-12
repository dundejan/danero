import { d, TransactionSchema } from '@danero/shared';
import { FIAT_CURRENCIES, HeaderMap, isValidIsoDate, parseCsv } from '../csv';
import { emptyResult, type ImportResult } from '../types';

export const ANYCOIN_BROKER = 'anycoin';

/**
 * Parser výpisů Anycoin (česká krypto směnárna). CSV s čárkou a pevnou
 * hlavičkou `Date,Type,Amount,Currency,Order ID`. Obchod tvoří PÁR řádků
 * spojený přes Order ID: `trade payment` (co odchází, záporné) + `trade fill`
 * (co přichází, kladné). Poplatek samostatně neexistuje — je ve spreadu.
 *
 * Datum ISO s milisekundami a `Z` (bere se prvních 10 znaků), čísla
 * s desetinnou tečkou, staked assety mají sufix `.S` (SOL.S → SOL).
 */

/** Povinné sloupce — jediná definice pro autodetekci i parser. */
const ANYCOIN_COLUMNS = ['date', 'type', 'amount', 'currency', 'order id'] as const;
const ANYCOIN_HEADER = 'Date,Type,Amount,Currency,Order ID';

/**
 * Fiat protihodnoty, které Anycoin obchoduje/oceňuje. Konzervativně: měna
 * mimo seznam se bere jako krypto → pár bez fiat nohy skončí warningem,
 * ne špatným výpočtem.
 */

/** Sufix `.S` značí staked variantu assetu — daňově tentýž asset. */
const normalizeSymbol = (value: string): string =>
  value.endsWith('.S') ? value.slice(0, -2) : value;

const parseNumber = (value: string): string | null =>
  /^-?\d+(\.\d+)?$/.test(value) ? value : null;

/** Řádky bez daňového dopadu → skipped s vysvětlením. */
const SKIP_TYPES = new Map<string, string>([
  ['deposit', 'Vklad — převod prostředků není zdanitelná událost.'],
  ['withdrawal', 'Výběr — převod prostředků (např. na vlastní peněženku) není zdanitelná událost.'],
  ['stake', 'Přesun do/ze stakingu — tentýž asset, bez daňového dopadu.'],
  ['unstake', 'Přesun do/ze stakingu — tentýž asset, bez daňového dopadu.'],
  ['withdrawal_block', 'Blokace prostředků před výběrem — bez daňového dopadu.'],
  ['withdrawal_unblock', 'Odblokování prostředků — bez daňového dopadu.'],
]);

/* ── Autodetekce ────────────────────────────────────────────────────────── */

/**
 * Detekce Anycoin CSV podle POVINNÝCH sloupců, ne podle celé hlavičky doslova.
 *
 * Do 12. 8. 2026 se první řádek porovnával na rovnost s
 * `Date,Type,Amount,Currency,Order ID` — jenže Anycoin exportuje i variantu
 * se sloupcem `anycoin TX ID` navíc. Parser ji zpracoval bez potíží, ale
 * autodetekce ji nepustila dál, takže uživatel dostal „Formát souboru
 * nepoznáváme“ nad souborem, který umíme přečíst.
 */
export function sniffAnycoinCsv(text: string): boolean {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const newline = input.indexOf('\n');
  const firstLine = newline === -1 ? input : input.slice(0, newline);
  const map = new HeaderMap(parseCsv(firstLine).headers.map((h) => h.toLowerCase()));
  return ANYCOIN_COLUMNS.every((column) => map.has(column));
}

/* ── Parser ─────────────────────────────────────────────────────────────── */

interface TradeLeg {
  line: number;
  date: string;
  /** Absolutní hodnota množství (směr určuje role payment/fill). */
  amount: string;
  currency: string;
  role: 'payment' | 'fill';
}

export function parseAnycoinCsv(text: string): ImportResult {
  const result = emptyResult(ANYCOIN_BROKER);
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const { headers, rows } = parseCsv(text);
  const map = new HeaderMap(headers.map((h) => h.toLowerCase()));
  for (const required of ANYCOIN_COLUMNS) {
    if (!map.has(required)) {
      result.errors.push({
        line: 1,
        message: `Soubor nevypadá jako výpis Anycoin — chybí sloupec "${required}". Očekáváme hlavičku: ${ANYCOIN_HEADER}`,
      });
      return result;
    }
  }

  // obchody = páry řádků přes Order ID; sbíráme a párujeme až po průchodu souborem
  const orders = new Map<string, TradeLeg[]>();

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((c) => c.trim() === '')) return;

    const type = map.get(row, 'type').toLowerCase();
    const amountRaw = map.get(row, 'amount');
    const currency = normalizeSymbol(map.get(row, 'currency'));

    const skipReason = SKIP_TYPES.get(type);
    if (skipReason !== undefined) {
      result.skipped.push({ line, message: `${skipReason} (${amountRaw} ${currency})` });
      return;
    }

    if (type === 'stake_reward') {
      result.warnings.push({
        line,
        message: `Odměny ze stakingu zatím daňově nezařazujeme — řádek (${amountRaw} ${currency}) jsme přeskočili. Pokud jsou částky významné, doplň je přes univerzální šablonu jako ostatní příjem.`,
      });
      return;
    }

    if (type === 'trade refund') {
      result.warnings.push({
        line,
        message: `Vrácený obchod (${amountRaw} ${currency}, Order ID ${map.get(row, 'order id') || 'neuvedeno'}) — zkontroluj, že párový obchod není započten.`,
      });
      return;
    }

    if (type !== 'trade payment' && type !== 'trade fill') {
      result.errors.push({
        line,
        message: `Neznámý typ řádku „${map.get(row, 'type')}“ — nahlaš nám ho, doplníme podporu.`,
        raw: row.join(','),
      });
      return;
    }

    /* ── trade payment / trade fill ── */

    const isoDate = map.get(row, 'date').slice(0, 10);
    if (!isValidIsoDate(isoDate)) {
      result.errors.push({
        line,
        message: `Neplatné datum „${map.get(row, 'date')}“ (očekáváme ISO formát, např. 2021-04-10T18:16:50.367Z).`,
        raw: row.join(','),
      });
      return;
    }

    const amount = parseNumber(amountRaw);
    if (amount === null || d(amount).eq(0) || currency === '') {
      result.errors.push({
        line,
        message: 'Obchodnímu řádku chybí platná částka nebo měna — řádek nelze zpracovat.',
        raw: row.join(','),
      });
      return;
    }

    const orderId = map.get(row, 'order id');
    if (orderId === '') {
      result.errors.push({
        line,
        message:
          'Obchodní řádek bez Order ID nejde spárovat s protistranou obchodu — doplň obchod ručně přes univerzální šablonu.',
        raw: row.join(','),
      });
      return;
    }

    const legs = orders.get(orderId) ?? [];
    legs.push({
      line,
      date: isoDate,
      amount: d(amount).abs().toString(),
      currency,
      role: type === 'trade payment' ? 'payment' : 'fill',
    });
    orders.set(orderId, legs);
  });

  /* ── párování obchodů: 1× payment + 1× fill na Order ID ── */

  for (const [orderId, legs] of orders) {
    const payments = legs.filter((leg) => leg.role === 'payment');
    const fills = legs.filter((leg) => leg.role === 'fill');
    if (payments.length !== 1 || fills.length !== 1) {
      result.errors.push({
        line: legs[0]!.line,
        message: `Obchod ${orderId} nemá kompletní pár platba + plnění (${payments.length}× trade payment, ${fills.length}× trade fill) — zkontroluj, že export pokrývá celé období, případně obchod doplň přes univerzální šablonu.`,
      });
      continue;
    }
    const payment = payments[0]!;
    const fill = fills[0]!;
    const paymentIsFiat = FIAT_CURRENCIES.has(payment.currency);
    const fillIsFiat = FIAT_CURRENCIES.has(fill.currency);

    if (!paymentIsFiat && !fillIsFiat) {
      result.warnings.push({
        line: payment.line,
        message: `Obchod ${orderId}: směna krypto–krypto (${payment.amount} ${payment.currency} → ${fill.amount} ${fill.currency}) bez fiat protihodnoty — oceň ji a doplň přes univerzální šablonu (prodej ${payment.currency} + nákup ${fill.currency}).`,
      });
      continue;
    }
    if (paymentIsFiat && fillIsFiat) {
      result.errors.push({
        line: payment.line,
        message: `Obchod ${orderId} vypadá jako směna peněz (${payment.currency} → ${fill.currency}) bez kryptoměny — nedokážeme ho zařadit, nahlaš nám ho.`,
      });
      continue;
    }

    // fiat → krypto = nákup; krypto → fiat = prodej. Cena za kus = fiat/qty
    // Decimalem; datum z fill řádku (dokončení obchodu).
    const isBuy = paymentIsFiat;
    const quantity = d(isBuy ? fill.amount : payment.amount);
    const fiatTotal = d(isBuy ? payment.amount : fill.amount);
    const symbol = isBuy ? fill.currency : payment.currency;
    const currency = isBuy ? payment.currency : fill.currency;

    try {
      result.transactions.push(
        TransactionSchema.parse({
          type: isBuy ? 'BUY' : 'SELL',
          id: `anycoin-${orderId}-${isBuy ? 'buy' : 'sell'}`,
          isin: symbol, // krypto: isin = symbol (BTC, ADA…)
          ticker: symbol,
          assetClass: 'CRYPTO',
          quantity,
          pricePerShare: fiatTotal.div(quantity),
          currency,
          tradeDate: fill.date,
        }),
      );
    } catch (err) {
      result.errors.push({
        line: payment.line,
        message: `Obchod ${orderId} se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return result;
}

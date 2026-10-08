import { d, TransactionSchema } from '@danero/shared';
import {
  cleanNumber,
  FIAT_CURRENCIES,
  HeaderMap,
  isValidIsoDate,
  normalizeHeader,
  parseCsv,
} from '../csv';
import { fnv1a64, uniqueIdFactory } from '../dedupe';
import { emptyResult, type ImportResult, type RowIssue } from '../types';

export const COINBASE_BROKER = 'coinbase';

/**
 * Parser Coinbase „transaction history“ CSV. Čtyři generace hlaviček (mapování
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
/**
 * Advanced Trade obchoduje i páry, kde na druhé straně není měna účtu, ale jiné
 * kryptoaktivum (BTC-USDC, ETH-BTC) — viz `TRADE_NOTES`.
 */
const ADVANCED_TRADE_TYPES = new Set([
  'advanced trade buy',
  'advance trade buy',
  'advanced trade sell',
  'advance trade sell',
]);

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

/**
 * Starší exporty zapisují tytéž odměny jako obyčejný „Receive“ a prozradí je
 * jen poznámka („Received 12.5 GRT from Coinbase Earn“). Bez nahlédnutí do
 * Notes by skončily mezi tichými převody, přestože převodem nejsou.
 */
const REWARD_RECEIVE_NOTES = /\bCoinbase (?:Earn|Rewards|Referral)\b/i;

/**
 * Výměna aktiva za nový symbol (dvojice řádků: úbytek starého, přírůstek
 * nového). Není to převod mezi peněženkami — bez zápisu výměny zůstane pozice
 * pod starým symbolem a prodej nového nemá z čeho vzít cenu nákupu. Řádky
 * nepárujeme a změnu symbolu sami nevydáváme (čeká na rozhodnutí), ale mlčet
 * o ní nesmíme → vlastní varování s návodem.
 *
 * Návod musí pokrýt i výměnu v jiném poměru než kus za kus (R-10b: výměna
 * kryptoaktiva vydavatelem časový test nepřerušuje, ať je poměr jakýkoli):
 * `ISIN_CHANGE` stěhuje lot beze změny počtu kusů a poměr nečte, takže by celá
 * nabývací cena zůstala na původním počtu kusů a částečný prodej nového symbolu
 * by ji odečetl celou. Poměr nese `MERGER` (`ratio_from`/`ratio_to`). Protože
 * řádky nepárujeme, nevíme, o který případ jde — varování proto popisuje oba.
 */
const ASSET_MIGRATION_TYPE = 'asset migration';

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


/** Notes u Convert: „Converted 0.05413984 BTC to 451.212148 USDC“. */
const CONVERT_NOTES = /^Converted [\d.,]+ \S+ to ([\d.,]+) (\S+)$/;

/**
 * Notes u Buy/Sell — zajímá nás protistrana za slovem „for“ (množství, aktivum):
 *  - Advanced Trade: „Sold 0.02 BTC for 1300.00 USDC on BTC-USDC at 65000 USDC/BTC“
 *    (novější exporty i bez „at …“),
 *  - starší Buy/Sell: „Bought 0.5 ETH for €912.50 EUR“, „… for € 300.00 EUR“.
 */
const TRADE_NOTES = /^(?:Bought|Sold) [\d.,]+ \S+ for \D{0,3}?([\d.,]+) ([A-Za-z0-9]+)\b/;

/* ── Sniff ───────────────────────────────────────────────────────────────── */

/** Detekce Coinbase CSV: v prvních ~5 řádcích je hlavička s Transaction Type + Quantity Transacted. */
/**
 * Kolik řádků nad hlavičkou snese preambule. Coinbase jich podle generace
 * exportu sype 0 až 7 („You can use this transaction report…“, `Transactions`,
 * `User,<jméno>,<uuid>`, prázdné řádky) — strop 5 v autodetekci znamenal, že
 * daňová varianta exportu propadla jako nepoznaný formát, přestože parser
 * hlavičku najde a soubor přečte. Odtud jedna sdílená funkce pro obojí.
 */
const MAX_PREAMBLE_LINES = 20;

/** Hlavička všech generací začíná `Timestamp,` nebo `ID,Timestamp,`… */
const HEADER_START = /^"?(?:ID"?,"?)?Timestamp"?,/;
/** …a vždy nese tyhle dva sloupce (odliší ji od cizího souboru). */
const HEADER_MARKERS = ['Transaction Type', 'Quantity Transacted'];

/**
 * Index řádku s hlavičkou, nebo −1. Sdílí autodetekce i parser.
 *
 * `limit` je strop preambule: autodetekce se dívá jen na začátek souboru (ať
 * nečte kvůli rozhodnutí celý export), parser hledá bez omezení — počet řádků
 * preambule se mezi generacemi liší a strop v parseru by odmítl soubor, který
 * dřív prošel.
 */
export function findCoinbaseHeaderLine(text: string, limit = Number.POSITIVE_INFINITY): number {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = input.split(/\r?\n/);
  return (Number.isFinite(limit) ? lines.slice(0, limit) : lines).findIndex(
    (line) =>
      HEADER_START.test(line.trim()) && HEADER_MARKERS.every((marker) => line.includes(marker)),
  );
}

export function sniffCoinbaseCsv(text: string): boolean {
  return findCoinbaseHeaderLine(text, MAX_PREAMBLE_LINES) !== -1;
}

/* ── Parser ──────────────────────────────────────────────────────────────── */

export function parseCoinbaseCsv(text: string): ImportResult {
  const result = emptyResult(COINBASE_BROKER);
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  // exporty mají před hlavičkou preambuli → najdi řádek s hlavičkou (tatáž
  // funkce, kterou používá autodetekce — jedna definice pro obojí)
  const lines = input.split(/\r?\n/);
  const headerIndex = findCoinbaseHeaderLine(input);
  if (headerIndex === -1) {
    result.errors.push({
      line: 1,
      message:
        'Soubor nevypadá jako Coinbase export — nenašli jsme hlavičku začínající „Timestamp“ nebo „ID,Timestamp“.',
    });
    return result;
  }

  const { headers: rawHeaders, rows } = parseCsv(lines.slice(headerIndex).join('\n'));
  const headers = rawHeaders.map(normalizeHeader);
  const map = new HeaderMap(headers);
  const headerLine = headerIndex + 1; // 1-based číslo řádku hlavičky v souboru

  // V1: měnový prefix ve jménech sloupců („EUR Subtotal“) — prefix = kód měny
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
        'Soubor nevypadá jako Coinbase export — nenašli jsme měnu (sloupec „Price Currency“/„Spot Price Currency“ ani měnový prefix názvů sloupců).',
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
    const notes = get(col.notes).trim();

    // odměna doručená jako „Receive“ patří k odměnám, ne k tichým převodům —
    // proto se ptáme dřív, než přijde na řadu SILENT_SKIP_TYPES
    const isRewardReceive = type === 'receive' && REWARD_RECEIVE_NOTES.test(notes);
    if (REWARD_TYPES.has(type) || isRewardReceive) {
      result.warnings.push({
        line,
        message: `${typeRaw} (${asset}) — odměny zatím daňově nezařazujeme, řádek přeskočen.`,
        raw,
      });
      return;
    }
    if (SILENT_SKIP_TYPES.has(type)) {
      result.skipped.push({
        line,
        message: `${typeRaw} (${asset}) — převod či interní pohyb, ne zdanitelná událost.`,
      });
      return;
    }
    if (type === ASSET_MIGRATION_TYPE) {
      const movedQuantity = get(col.quantity).trim();
      result.warnings.push({
        line,
        message: `${typeRaw} (${[asset, movedQuantity].filter((part) => part !== '').join(' ')}) — Coinbase vyměnil aktivum za nový symbol a tenhle řádek jsme přeskočili. Dokud výměnu nezapíšeš, zůstává pozice pod starým symbolem a prodej nového nemá z čeho vzít cenu nákupu. Doplň ji přes univerzální šablonu jedním řádkem typu CORPORATE_ACTION: starý symbol do sloupce isin, nový do sloupce new_isin. Do sloupce subtype napiš ISIN_CHANGE jen při výměně kus za kus, tedy když ti přibylo stejně kusů nového symbolu, kolik ubylo starého (počty jsou na dvojici řádků „Asset Migration“). Liší-li se počty, napiš subtype MERGER a poměr výměny: počet starých kusů do ratio_from, počet nových do ratio_to. ISIN_CHANGE poměr nečte — cena nákupu by zůstala rozpočítaná na starý počet kusů a daň z prodeje by vyšla špatně.`,
        raw,
      });
      return;
    }
    if (WARN_SKIP_TYPES.has(type)) {
      result.warnings.push({
        line,
        message: `Typ „${typeRaw}“ zatím nepodporujeme — řádek přeskočen. Pokud jde o zdanitelnou událost, doplň ji přes univerzální šablonu.`,
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
        message: `Neznámý typ transakce „${typeRaw}“ — nahlaš nám ho, doplníme podporu.`,
        raw,
      });
      return;
    }

    // společné náležitosti obchodních řádků
    const date = toIsoDate(get(col.timestamp));
    if (date === null) {
      result.errors.push({
        line,
        message: `Neplatný čas „${get(col.timestamp)}“ (očekáváme ISO datum, např. 2024-12-19T17:59:59Z).`,
        raw,
      });
      return;
    }
    const currency = (prefix ? prefix.toUpperCase() : get(col.currency).trim().toUpperCase());
    if (!/^[A-Z]{3}$/.test(currency)) {
      result.errors.push({
        line,
        message: `Měnu se nepodařilo přečíst — nalezeno „${currency}“, očekáváme třípísmenný kód (EUR, USD…).`,
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
      const match = CONVERT_NOTES.exec(notes);
      const targetQuantityRaw = match ? cleanCoinbaseNumber(match[1]!) : null;
      if (!match || targetQuantityRaw === null || d(targetQuantityRaw).eq(0)) {
        result.errors.push({
          line,
          message: `Convert bez čitelné poznámky („${notes}“) — nepoznáme cílové aktivum a počet kusů, směnu doplň přes univerzální šablonu jako prodej + nákup.`,
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

    // R-10c: Buy/Sell na páru mimo měnu účtu (BTC-USDC, ETH-BTC) je směna
    // krypto–krypto. `Price Currency` i `Subtotal` nesou měnu účtu a protistrana
    // je jen v Notes — vydáme ji jako druhou nohu oceněnou týmž Subtotalem,
    // stejně jako Convert. Původní noha se nemění (id ani obsah), takže už
    // nahraný výpis je při novém nahrání duplicita a doplní se jen chybějící noha.
    // Kotace v jiné fiat měně (BTC-EUR na účtu v CZK) druhou nohu nemá: na druhé
    // straně jsou peníze, ne kryptoaktivum.
    let counterLeg: Record<string, unknown> | null = null;
    if (isBuy || isSell) {
      const match = TRADE_NOTES.exec(notes);
      const counterQuantityRaw = match ? cleanCoinbaseNumber(match[1]!) : null;
      const counterQuantity = counterQuantityRaw === null ? null : d(counterQuantityRaw);
      if (!match || counterQuantity === null || counterQuantity.eq(0)) {
        // Protistranu neznáme. Obyčejný Buy/Sell se platí měnou účtu, tam není
        // co doplňovat; u Advanced Trade by ale chybějící noha zmizela potichu.
        if (ADVANCED_TRADE_TYPES.has(type)) {
          result.warnings.push({
            line,
            message: `${typeRaw} (${asset}): z poznámky${notes === '' ? '' : ` („${notes}“)`} nejde poznat, za co se obchodovalo. Řádek jsme uložili oceněný v ${currency}. Pokud ale šlo o směnu krypto–krypto (pár jako BTC-USDC nebo ETH-BTC), její druhá strana tu chybí — oceň ji a doplň přes univerzální šablonu jako ${isBuy ? 'prodej' : 'nákup'} druhého aktiva.`,
            raw,
          });
        }
      } else {
        const counterAsset = match[2]!.toUpperCase();
        if (counterAsset !== currency && !FIAT_CURRENCIES.has(counterAsset)) {
          counterLeg = {
            type: isBuy ? 'SELL' : 'BUY',
            id: `${baseId}-${isBuy ? 'sell' : 'buy'}`,
            isin: counterAsset,
            assetClass: 'CRYPTO',
            quantity: counterQuantity.toString(),
            pricePerShare: subtotal.div(counterQuantity).toString(),
            currency,
            tradeDate: date,
            note: notes,
          };
        }
      }
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
    if (counterLeg !== null) push(counterLeg);
  });

  return result;
}

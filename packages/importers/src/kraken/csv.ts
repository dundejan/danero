import { d, TransactionSchema } from '@danero/shared';
import { FIAT_CURRENCIES, HeaderMap, isValidIsoDate, normalizeHeader, parseCsv } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const KRAKEN_BROKER = 'kraken';

/**
 * Parser Kraken ledgers.csv — kompletní účetní kniha účtu (obchody, vklady,
 * výběry, staking). Hlavičky se mezi generacemi exportu liší (novější přidávají
 * `wallet`, `subclass`, `amountusd`) → mapování VÝHRADNĚ podle názvů sloupců.
 * Obchod = PÁR řádků `type=trade` se stejným `refid` (jeden asset −, druhý +);
 * nákup kartou = pár `spend`+`receive`. trades.csv se odmítá — neobsahuje
 * vklady/výběry a vedl by ke dvojímu započtení vedle ledgers.
 */

/* ── Normalizace assetů ──────────────────────────────────────────────────── */

/**
 * Kraken interní kódy: fiat s prefixem `Z` (ZEUR), krypto s prefixem `X`
 * (XXBT = BTC!), staked se sufixem `.S` (ADA.S). Novější exporty píší kódy
 * rovnou (BTC, EUR) — mapa proto obsahuje jen známé aliasy, ostatní projdou beze změny.
 */
const ASSET_ALIASES: Record<string, string> = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  XXRP: 'XRP',
  XLTC: 'LTC',
  XXLM: 'XLM',
  XZEC: 'ZEC',
  XXMR: 'XMR',
  XXDG: 'DOGE',
  XDG: 'DOGE',
  ZEUR: 'EUR',
  ZUSD: 'USD',
  ZGBP: 'GBP',
  ZCAD: 'CAD',
  ZJPY: 'JPY',
  ZAUD: 'AUD',
  ZCZK: 'CZK',
};

export function normalizeKrakenAsset(asset: string): string {
  let code = asset.trim().toUpperCase();
  // staked varianta (ADA.S) je pro daňové účely tentýž asset
  if (code.endsWith('.S')) code = code.slice(0, -2);
  return ASSET_ALIASES[code] ?? code;
}

// Fiat poznáváme whitelistem ISO kódů (sdílený FIAT_CURRENCIES), NE prefixem —
// „EUR" se vyskytuje i bez Z.

/* ── Čísla a datumy ──────────────────────────────────────────────────────── */

/** Kraken čísla: čistě desetinná tečka, bez tisícových oddělovačů. */
function parseKrakenNumber(value: string): string | null {
  const v = value.replace(/\s/g, '');
  if (v === '') return null;
  return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
}

/** Čas `YYYY-MM-DD HH:MM:SS` (+ volitelné zlomky), UTC → ISO datum. */
function toIsoDate(time: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T]|$)/.exec(time.trim());
  const iso = match ? match[1]! : null;
  return iso !== null && isValidIsoDate(iso) ? iso : null;
}

/* ── Sniff ───────────────────────────────────────────────────────────────── */

const firstLine = (text: string): string => {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
};

/**
 * Detekce Kraken exportů podle hlavičky: ledgers.csv (txid + refid + aclass +
 * balance) i trades.csv (txid + ordertxid + pair) — trades parser odmítne se
 * srozumitelnou hláškou, nesmí ale propadnout do univerzální šablony.
 */
export function sniffKrakenCsv(text: string): boolean {
  if (text.trim() === '') return false;
  const headers = new Set(parseCsv(firstLine(text)).headers.map(normalizeHeader));
  const ledgers =
    headers.has('txid') && headers.has('refid') && headers.has('aclass') && headers.has('balance');
  const trades = headers.has('txid') && headers.has('ordertxid') && headers.has('pair');
  return ledgers || trades;
}

/* ── Parser ──────────────────────────────────────────────────────────────── */

/** Jedna noha obchodu (řádek type=trade / spend / receive) čekající na spárování. */
interface TradeLeg {
  line: number;
  txid: string;
  time: string;
  asset: string;
  amountRaw: string;
  feeRaw: string;
  raw: string;
}

const REQUIRED_HEADERS = ['txid', 'refid', 'time', 'type', 'asset', 'amount'] as const;

export function parseKrakenCsv(text: string): ImportResult {
  const result = emptyResult(KRAKEN_BROKER);
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const { headers: rawHeaders, rows } = parseCsv(text);
  const headers = rawHeaders.map(normalizeHeader);
  const headerSet = new Set(headers);

  // trades.csv (txid,ordertxid,pair,…) vedle ledgers = dvojí započtení → odmítnout
  if (headerSet.has('ordertxid') && headerSet.has('pair')) {
    result.errors.push({
      line: 1,
      message:
        'Nahraj prosím export Ledgers (ledgers.csv) — obsahuje kompletní historii včetně vkladů; trades.csv by vedl ke dvojímu započtení.',
    });
    return result;
  }

  const map = new HeaderMap(headers);
  for (const required of REQUIRED_HEADERS) {
    if (!map.has(required)) {
      result.errors.push({
        line: 1,
        message: `Soubor nevypadá jako Kraken ledgers.csv — chybí sloupec „${required}". Nalezené sloupce: ${rawHeaders.filter((h) => h !== '').join(', ')}`,
      });
      return result;
    }
  }

  // obchodní páry sbíráme podle refid, ostatní typy vyřizujeme rovnou
  const tradeGroups = new Map<string, TradeLeg[]>();

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((cell) => cell.trim() === '')) return;

    const type = map.get(row, 'type').toLowerCase();
    const subtype = map.get(row, 'subtype').toLowerCase();
    const asset = normalizeKrakenAsset(map.get(row, 'asset'));
    const raw = row.join(',');

    switch (type) {
      case 'trade':
      case 'spend':
      case 'receive': {
        const refid = map.get(row, 'refid');
        const legs = tradeGroups.get(refid) ?? [];
        legs.push({
          line,
          txid: map.get(row, 'txid'),
          time: map.get(row, 'time'),
          asset: map.get(row, 'asset'),
          amountRaw: map.get(row, 'amount'),
          feeRaw: map.get(row, 'fee'),
          raw,
        });
        tradeGroups.set(refid, legs);
        return;
      }
      case 'deposit':
      case 'withdrawal':
        result.skipped.push({
          line,
          message: `${type === 'deposit' ? 'Vklad' : 'Výběr'} ${asset} — převod peněz či kryptoaktiv, ne zdanitelná událost.`,
        });
        return;
      case 'staking':
        result.warnings.push({
          line,
          message: `Odměna ze stakingu (${asset}) — odměny ze stakingu zatím daňově nezařazujeme, řádek přeskočen.`,
          raw,
        });
        return;
      case 'earn':
        if (subtype === 'reward') {
          result.warnings.push({
            line,
            message: `Odměna z Kraken Earn (${asset}) — odměny ze stakingu zatím daňově nezařazujeme, řádek přeskočen.`,
            raw,
          });
        } else {
          // allocation/deallocation/migration… = přesun v rámci účtu, ne daňová událost
          result.skipped.push({
            line,
            message: `Přesun v rámci Kraken Earn (${subtype || 'bez subtypu'}, ${asset}) — ne daňová událost.`,
          });
        }
        return;
      case 'transfer':
        result.skipped.push({
          line,
          message: `Interní přesun (${subtype || 'transfer'}, ${asset}) — ne daňová událost.`,
        });
        return;
      case 'margin':
      case 'margin trade':
      case 'rollover':
      case 'settled':
        result.warnings.push({
          line,
          message: `Řádek „${type}": marginové obchody na Krakenu zatím nepodporujeme — řádek přeskočen, výsledek doplň přes univerzální šablonu.`,
          raw,
        });
        return;
      default:
        result.warnings.push({
          line,
          message: `Typ záznamu „${map.get(row, 'type')}" zatím nepodporujeme — řádek přeskočen. Pokud jde o zdanitelnou událost, doplň ji přes univerzální šablonu.`,
          raw,
        });
        return;
    }
  });

  // druhý průchod: párování obchodů podle refid
  for (const [refid, legs] of tradeGroups) {
    if (legs.length !== 2) {
      for (const leg of legs) {
        result.errors.push({
          line: leg.line,
          message: `Obchod ${refid} nemá párový řádek (druhou stranu směny) — export je nejspíš neúplný, stáhni prosím kompletní ledgers.csv.`,
          raw: leg.raw,
        });
      }
      continue;
    }

    const parsed = legs.map((leg) => ({
      leg,
      date: toIsoDate(leg.time),
      amount: parseKrakenNumber(leg.amountRaw),
      fee: parseKrakenNumber(leg.feeRaw) ?? '0',
      asset: normalizeKrakenAsset(leg.asset),
    }));

    let invalid = false;
    for (const p of parsed) {
      if (p.date === null) {
        result.errors.push({
          line: p.leg.line,
          message: `Neplatný čas „${p.leg.time}" (očekáváme YYYY-MM-DD HH:MM:SS).`,
          raw: p.leg.raw,
        });
        invalid = true;
      } else if (p.amount === null) {
        result.errors.push({
          line: p.leg.line,
          message: `Částku „${p.leg.amountRaw}" se nepodařilo přečíst.`,
          raw: p.leg.raw,
        });
        invalid = true;
      }
    }
    if (invalid) continue;

    const a = parsed[0]!;
    const b = parsed[1]!;
    const aIsFiat = FIAT_CURRENCIES.has(a.asset);
    const bIsFiat = FIAT_CURRENCIES.has(b.asset);

    if (aIsFiat && bIsFiat) {
      result.skipped.push({
        line: a.leg.line,
        message: `Směna měn ${a.asset} ↔ ${b.asset} — FX konverze, pro daňový výpočet kryptoaktiv není potřeba.`,
      });
      continue;
    }
    if (!aIsFiat && !bIsFiat) {
      const sold = d(a.amount!).lt(0) ? a : b;
      const bought = sold === a ? b : a;
      result.warnings.push({
        line: a.leg.line,
        message: `Směna krypto–krypto ${sold.asset} → ${bought.asset} bez fiat protihodnoty — oceň a doplň přes univerzální šablonu jako prodej + nákup. Řádky přeskočeny.`,
        raw: `${a.leg.raw} | ${b.leg.raw}`,
      });
      continue;
    }

    const fiat = aIsFiat ? a : b;
    const crypto = aIsFiat ? b : a;
    const fiatAmount = d(fiat.amount!);
    const cryptoAmount = d(crypto.amount!);

    const type = cryptoAmount.gt(0) && fiatAmount.lt(0)
      ? 'BUY'
      : cryptoAmount.lt(0) && fiatAmount.gt(0)
        ? 'SELL'
        : null;
    if (type === null) {
      result.errors.push({
        line: crypto.leg.line,
        message: `Obchod ${refid}: obě strany směny mají stejné znaménko (${fiat.amount} ${fiat.asset} / ${crypto.amount} ${crypto.asset}) — řádky nedávají smysl jako nákup ani prodej.`,
        raw: `${a.leg.raw} | ${b.leg.raw}`,
      });
      continue;
    }

    const quantity = cryptoAmount.abs();
    if (quantity.eq(0)) {
      result.errors.push({
        line: crypto.leg.line,
        message: `Obchod ${refid} má nulový počet kusů — řádek nelze zpracovat.`,
        raw: crypto.leg.raw,
      });
      continue;
    }
    const total = fiatAmount.abs();

    // poplatek ve fiat odečítáme; poplatek v kryptu ocenit neumíme → poctivý warning
    const cryptoFee = d(crypto.fee);
    if (cryptoFee.gt(0)) {
      result.warnings.push({
        line: crypto.leg.line,
        message: `Poplatek ${crypto.fee} ${crypto.asset} je v kryptoměně — neumíme ho ocenit ve fiat, do výpočtu nebyl odečten.`,
      });
    }
    const fiatFee = d(fiat.fee);
    const fee = fiatFee.gt(0) ? { amount: fiatFee.toString(), currency: fiat.asset } : undefined;

    const id = `kraken-${crypto.leg.txid !== '' ? crypto.leg.txid : fnv1a64(`${refid}|${crypto.leg.raw}`)}`;

    try {
      result.transactions.push(
        TransactionSchema.parse({
          type,
          id,
          isin: crypto.asset,
          assetClass: 'CRYPTO',
          quantity: quantity.toString(),
          pricePerShare: total.div(quantity).toString(),
          currency: fiat.asset,
          fee,
          tradeDate: crypto.date!,
        }),
      );
    } catch (err) {
      result.errors.push({
        line: crypto.leg.line,
        message: `Obchod ${refid} se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw: `${a.leg.raw} | ${b.leg.raw}`,
      });
    }
  }

  return result;
}
